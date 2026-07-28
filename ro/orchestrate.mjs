#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VERSION = 1;
const DEFAULTS = {
  agents: 3,
  concurrency: 3,
  thinking: "high",
  timeoutMs: 12 * 60 * 1000,
  killGraceMs: 5_000,
  retries: 1,
  piBin: process.env.PI_BIN || "pi",
};

const usage = `Usage:
  node ro/orchestrate.mjs "TOPIC" [options]
  node ro/orchestrate.mjs --resume RUN_DIRECTORY

Options:
  --agents N          Round-1 workers (2-6, default 3)
  --concurrency N     Maximum simultaneous Pi workers (default min(agents, 3))
  --model MODEL       Model passed to each Pi worker
  --thinking LEVEL    Pi thinking level (default high)
  --timeout-ms N      Per-worker hard timeout (default 720000)
  --kill-grace-ms N   Grace before a timed-out worker is force-killed (default 5000)
  --retries N         Retries for a failed worker (default 1)
  --allow-private-sources  Permit URL verification against private addresses (testing only)
  --output DIR        New run directory (must not already exist)
  --resume DIR        Resume a prior run directory
  --single-round      Skip gap-filling Round 2
  --pi-bin PATH       Pi executable; supports a test double
  --dry-run           Create plan/state only; launch no workers
  --help              Show this help
`;

function fail(message) {
  throw new Error(message);
}

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "research";
}

function safeId(value, fallback) {
  return slugify(String(value || fallback)).slice(0, 48) || fallback;
}

function runId(topic) {
  return `${now().replace(/[:.]/g, "-")}-${slugify(topic)}`;
}

function parsePositiveInteger(raw, flag, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${flag} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, singleRound: false, dryRun: false, allowPrivateSources: false, resume: null, output: null, model: null };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      return value;
    };

    switch (arg) {
      case "--agents":
        options.agents = parsePositiveInteger(next(), arg, { min: 2, max: 6 });
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(next(), arg, { min: 1, max: 6 });
        break;
      case "--thinking":
        options.thinking = next();
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(next(), arg, { min: 1_000, max: 60 * 60 * 1000 });
        break;
      case "--kill-grace-ms":
        options.killGraceMs = parsePositiveInteger(next(), arg, { min: 100, max: 60 * 1000 });
        break;
      case "--retries":
        options.retries = parsePositiveInteger(next(), arg, { min: 0, max: 3 });
        break;
      case "--allow-private-sources":
        options.allowPrivateSources = true;
        break;
      case "--output":
        options.output = resolve(next());
        break;
      case "--resume":
        options.resume = resolve(next());
        break;
      case "--model":
        options.model = next();
        break;
      case "--pi-bin":
        options.piBin = next();
        break;
      case "--single-round":
        options.singleRound = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (options.resume && options.output) fail("Use either --resume or --output, not both");
  if (options.resume && positional.length > 0) fail("Do not pass a topic when using --resume");
  if (!options.resume && positional.length !== 1) fail("Pass exactly one research topic, or use --resume");
  options.topic = positional[0] || null;
  options.concurrency = Math.min(options.concurrency, options.agents);
  return options;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function writeAtomic(path, contents) {
  await ensureDir(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function writeJson(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function truncate(value, length) {
  const text = String(value ?? "");
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function normaliseUrl(value) {
  try {
    const url = new URL(String(value).trim().replace(/[.,;:]+$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function uniqueUrls(values) {
  return [...new Set(values.map(normaliseUrl).filter(Boolean))];
}

function urlsInText(text) {
  return uniqueUrls([...String(text).matchAll(/https?:\/\/[^\s)\]}>"']+/g)].map((match) => match[0]));
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .join("");
}

function extractAssistantText(events) {
  const messages = [];
  for (const event of events) {
    if (event?.type === "message_end" && event.message?.role === "assistant") {
      messages.push(contentText(event.message.content));
    }
    if (event?.type === "agent_end" && Array.isArray(event.messages)) {
      for (const message of event.messages) {
        if (message?.role === "assistant") messages.push(contentText(message.content));
      }
    }
  }
  return messages.filter(Boolean).at(-1) || "";
}

function extractUsage(events) {
  const candidates = [];
  for (const event of events) {
    if (event?.message?.usage) candidates.push(event.message.usage);
    if (event?.message?.providerMetadata?.usage) candidates.push(event.message.providerMetadata.usage);
  }
  return candidates.at(-1) || null;
}

function extractJson(text) {
  const stripped = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const starts = [stripped.indexOf("{"), stripped.indexOf("[")].filter((index) => index >= 0);
    if (starts.length === 0) fail("Worker did not return JSON");
    const start = Math.min(...starts);
    const candidate = stripped.slice(start);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (end < 0) fail("Worker returned incomplete JSON");
    return JSON.parse(candidate.slice(0, end + 1));
  }
}

function compact(value, limit = 28_000) {
  const text = JSON.stringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function phasePrompt(phase, body) {
  return `PHASE: ${phase}\n\n${body}`;
}

function splitPrompt(topic, agents) {
  return phasePrompt("split", `You are the research planner for an evidence-backed deep-research pipeline.

Topic: ${topic}

Split the topic into exactly ${agents} distinct, non-overlapping angles. Together they must cover the topic. Return ONLY JSON:
{
  "angles": [
    {"id":"angle-1", "angle":"short name", "focus":"what this worker must establish", "queries":["specific query", "specific query"]}
  ]
}
No markdown and no commentary.`);
}

function researcherPrompt({ topic, angle, round, shared }) {
  const gapBlock = round === 2
    ? `\nYou are filling this specific gap, not repeating Round 1:\n${JSON.stringify(angle, null, 2)}\n\nShared Round-1 facts and source catalog:\n${compact(shared, 16_000)}\n`
    : `\nYour assigned angle:\n${JSON.stringify(angle, null, 2)}\n`;
  return phasePrompt(`research-${round}`, `You are an independent evidence researcher. Research one bounded angle of this topic:\n${topic}\n${gapBlock}
Use available research tools. Prefer research_search/research_fetch; if the Chrome bridge is unavailable, use another available web-search/fetch tool. Fetch primary sources before citing them.

Rules:
- Never cite a URL you did not retrieve and successfully inspect in this worker session.
- Record failed, blocked, or paywalled URLs separately.
- Seek contradictions and state uncertainty; do not make unsupported claims.
- Return structured findings only; do not write files and do not produce a prose report.

Return ONLY JSON:
{
  "scope":"${round === 1 ? angle.id : angle.id || "gap"}",
  "findings":[{"claim":"precise claim", "evidence":"what the fetched source establishes", "sources":["https://..."]}],
  "sources":["https://..."],
  "failedSources":[{"url":"https://...", "reason":"404 | blocked | paywall | other"}],
  "contradictions":["specific disagreement or uncertainty"],
  "openQuestions":["remaining question"]
}`);
}

function coordinatorPrompt(topic, findings) {
  return phasePrompt("coordinate", `You coordinate an evidence-backed research pipeline.

Topic: ${topic}

Round-1 findings:\n${compact(findings, 48_000)}

Identify only material gaps and genuine contradictions. Build compact shared memory. Return ONLY JSON:
{
  "knownFacts":[{"theme":"name", "facts":["fact with source URL"]}],
  "gaps":[{"id":"gap-1", "gap":"missing question", "why":"why it matters", "queries":["specific query"]}],
  "contradictions":["specific unresolved disagreement"],
  "coverage":"brief assessment"
}
Do not assign redundant work. If Round 1 is sufficient, return an empty gaps array.`);
}

function synthesizerPrompt({ topic, findings, verification, rounds }) {
  const verified = verification.filter((entry) => entry.classification === "OK").map((entry) => entry.url);
  return phasePrompt("synthesize", `Write a comprehensive, cited markdown research report.

Topic: ${topic}
Rounds completed: ${rounds}

Evidence from workers:\n${compact(findings, 62_000)}

Citation verification results:\n${compact(verification, 18_000)}

Hard rules:
- Cite only these URL(s) submitted to a completed non-error worker fetch/extract call and passed URL reachability: ${JSON.stringify(verified)}
- Do not invent, reconstruct, or cite any other URL.
- URL reachability is not claim-level semantic verification; if evidence is weak, contradictory, single-source, or blocked, label that limitation plainly.
- Synthesize by theme; do not concatenate worker findings.

Use this structure:
# [Title]
## Executive Summary
## Findings
## Contradictions & Open Questions
## Limitations
## Sources

Return markdown only.`);
}

function repairPrompt({ report, validUrls, invalidUrls }) {
  return phasePrompt("repair-citations", `Repair this markdown report's citation integrity.

Invalid or unverified citations that must be removed or replaced with an honest unverified statement:\n${JSON.stringify(invalidUrls)}

The ONLY URLs allowed in the repaired report are:\n${JSON.stringify(validUrls)}

Keep supported analysis, remove unsupported factual claims, preserve the required sections, and return markdown only. Do not add new sources.\n\nREPORT:\n${truncate(report, 52_000)}`);
}

function judgePrompt({ topic, report, citationAudit }) {
  return phasePrompt("judge", `Independently judge this research report. Do not rewrite it.

Topic: ${topic}
Citation audit: ${compact(citationAudit, 8_000)}
Report:\n${truncate(report, 56_000)}

Return ONLY JSON:
{
  "scores":{"depth":1,"accuracy":1,"coverage":1,"synthesis":1,"actionability":1},
  "overall":1.0,
  "strengths":["..."],
  "weaknesses":["..."],
  "requiredFixes":["..."],
  "verdict":"approve | needs-fixes"
}
Score each dimension from 1 to 10. Any invalid citation is an accuracy fault.`);
}

function stopWorker(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The child already exited between the timeout and the signal.
  }
}

function parseJsonlEvents(raw, label) {
  const invalidLines = [];
  const events = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidLines.push(index + 1);
    }
  }
  if (invalidLines.length > 0) fail(`${label} emitted malformed JSONL at line(s): ${invalidLines.slice(0, 8).join(", ")}`);
  if (!events.some((event) => event?.type === "agent_end")) fail(`${label} emitted no agent_end event`);
  return events;
}

function urlsFromToolValue(value) {
  return uniqueUrls(urlsInText(typeof value === "string" ? value : JSON.stringify(value ?? {})));
}

function fetchedUrlsFromEvents(events) {
  const calls = new Map();
  const fetched = [];
  for (const event of events) {
    if (event?.type === "tool_execution_start") {
      calls.set(event.toolCallId, { toolName: event.toolName || "", args: event.args });
      continue;
    }
    if (event?.type !== "tool_execution_end" || event.isError) continue;
    const call = calls.get(event.toolCallId);
    const toolName = String(event.toolName || call?.toolName || "").toLowerCase();
    if (!/(fetch|extract|get_content)/.test(toolName)) continue;
    fetched.push(...urlsFromToolValue(call?.args), ...urlsFromToolValue(event.result));
  }
  return uniqueUrls(fetched);
}

async function spawnPi({ config, outputDir, label, prompt, metrics }) {
  const logsDir = join(outputDir, "logs");
  const sessionsDir = join(outputDir, "sessions");
  await ensureDir(logsDir);
  await ensureDir(sessionsDir);

  const args = ["--mode", "json", "--session-dir", sessionsDir, "--name", label, "--no-context-files", "--no-builtin-tools", "--thinking", config.thinking];
  if (config.model) args.push("--model", config.model);
  args.push("-p", prompt);

  const startedAt = Date.now();
  const stdout = [];
  const stderr = [];
  const workerCwd = typeof config.workerCwd === "string" && existsSync(config.workerCwd)
    ? config.workerCwd
    : PACKAGE_ROOT;
  const child = spawn(config.piBin, args, {
    cwd: workerCwd,
    detached: process.platform !== "win32",
    env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
    // `pi -p` waits for stdin EOF in headless mode. Never leave its default pipe open.
    stdio: ["ignore", "pipe", "pipe"],
  });

  const completion = new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let timedOut = false;
    let graceTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      callback(value);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopWorker(child, "SIGTERM");
      graceTimer = setTimeout(() => stopWorker(child, "SIGKILL"), config.killGraceMs);
    }, config.timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => finish(rejectRun, new Error(`${label} failed to spawn: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(rejectRun, new Error(`${label} timed out after ${config.timeoutMs}ms and exited${signal ? ` (${signal})` : ""}`));
      } else if (code === 0) {
        finish(resolveRun, { code, signal });
      } else {
        finish(rejectRun, new Error(`${label} exited with code ${code}${signal ? ` (${signal})` : ""}`));
      }
    });
  });

  try {
    await completion;
  } catch (error) {
    await writeAtomic(join(logsDir, `${label}.stderr.log`), Buffer.concat(stderr).toString("utf8"));
    await writeAtomic(join(logsDir, `${label}.jsonl`), Buffer.concat(stdout).toString("utf8"));
    throw error;
  }

  const rawStdout = Buffer.concat(stdout).toString("utf8");
  const rawStderr = Buffer.concat(stderr).toString("utf8");
  await writeAtomic(join(logsDir, `${label}.jsonl`), rawStdout);
  if (rawStderr) await writeAtomic(join(logsDir, `${label}.stderr.log`), rawStderr);

  const events = parseJsonlEvents(rawStdout, label);
  const text = extractAssistantText(events);
  if (!text) fail(`${label} returned no assistant text; inspect logs/${label}.jsonl`);

  const record = {
    label,
    durationMs: Date.now() - startedAt,
    usage: extractUsage(events),
    fetchedUrls: fetchedUrlsFromEvents(events).length,
    log: `logs/${label}.jsonl`,
  };
  metrics.workers.push(record);
  return { text, record, fetchedUrls: fetchedUrlsFromEvents(events) };
}

async function runWithRetry({ config, outputDir, label, prompt, metrics, expectJson = true }) {
  let lastError;
  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const attemptLabel = attempt === 0 ? label : `${label}-retry-${attempt}`;
    try {
      const result = await spawnPi({ config, outputDir, label: attemptLabel, prompt, metrics });
      return { value: expectJson ? extractJson(result.text) : result.text.trim(), fetchedUrls: result.fetchedUrls };
    } catch (error) {
      lastError = error;
      metrics.failures.push({ label: attemptLabel, error: error.message, at: now() });
    }
  }
  throw lastError;
}

function normaliseAngles(payload, count) {
  const angles = Array.isArray(payload) ? payload : payload?.angles;
  if (!Array.isArray(angles) || angles.length < count) fail(`Splitter returned fewer than ${count} angles`);
  const usedIds = new Set();
  return angles.slice(0, count).map((angle, index) => {
    const baseId = safeId(angle.id, `angle-${index + 1}`);
    const id = usedIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
    usedIds.add(id);
    return {
      id,
      angle: String(angle.angle || `Angle ${index + 1}`),
      focus: String(angle.focus || angle.description || "Research this dimension thoroughly."),
      queries: Array.isArray(angle.queries || angle.search_queries) ? (angle.queries || angle.search_queries).map(String).slice(0, 5) : [],
    };
  });
}

function normaliseFindings(payload, scope, fetchedUrls) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const observed = new Set(uniqueUrls(fetchedUrls));
  const claimedSources = uniqueUrls([...(Array.isArray(payload?.sources) ? payload.sources : []), ...findings.flatMap((finding) => finding?.sources || [])]);
  const sources = claimedSources.filter((url) => observed.has(url));
  const unobservedSources = claimedSources.filter((url) => !observed.has(url));
  return {
    scope,
    findings: findings.slice(0, 16).map((finding) => ({
      claim: truncate(finding?.claim || "Unspecified claim", 1_200),
      evidence: truncate(finding?.evidence || "No evidence supplied", 2_000),
      sources: uniqueUrls(Array.isArray(finding?.sources) ? finding.sources : []).filter((url) => observed.has(url)),
    })),
    sources,
    fetchedUrls: [...observed],
    failedSources: [
      ...(Array.isArray(payload?.failedSources) ? payload.failedSources.slice(0, 20) : []),
      ...unobservedSources.map((url) => ({ url, reason: "not observed in a completed non-error fetch/extract tool call" })),
    ],
    contradictions: Array.isArray(payload?.contradictions) ? payload.contradictions.map(String).slice(0, 12) : [],
    openQuestions: Array.isArray(payload?.openQuestions) ? payload.openQuestions.map(String).slice(0, 12) : [],
  };
}

function normaliseCoordinator(payload) {
  const usedIds = new Set();
  return {
    knownFacts: Array.isArray(payload?.knownFacts) ? payload.knownFacts.slice(0, 20) : [],
    gaps: Array.isArray(payload?.gaps) ? payload.gaps.slice(0, 12).map((gap, index) => {
      const baseId = safeId(gap?.id, `gap-${index + 1}`);
      const id = usedIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
      usedIds.add(id);
      return {
        id,
        gap: String(gap?.gap || "Unspecified gap"),
        why: String(gap?.why || "Coverage is incomplete."),
        queries: Array.isArray(gap?.queries) ? gap.queries.map(String).slice(0, 5) : [],
      };
    }) : [],
    contradictions: Array.isArray(payload?.contradictions) ? payload.contradictions.map(String).slice(0, 12) : [],
    coverage: String(payload?.coverage || "No coverage assessment supplied."),
  };
}

function phaseArtifactPath(directory, id) {
  const root = resolve(directory);
  const path = resolve(root, `${safeId(id, "artifact")}.json`);
  if (!path.startsWith(`${root}/`)) fail(`Unsafe phase artifact path for ${id}`);
  return path;
}

function normaliseJudge(payload) {
  const rawScores = payload?.scores || {};
  const scores = {};
  for (const key of ["depth", "accuracy", "coverage", "synthesis", "actionability"]) {
    const value = Number(rawScores[key]);
    scores[key] = Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 1;
  }
  const average = Object.values(scores).reduce((sum, value) => sum + value, 0) / 5;
  return {
    scores,
    overall: Number.isFinite(Number(payload?.overall)) ? Number(payload.overall) : Number(average.toFixed(1)),
    strengths: Array.isArray(payload?.strengths) ? payload.strengths.map(String).slice(0, 8) : [],
    weaknesses: Array.isArray(payload?.weaknesses) ? payload.weaknesses.map(String).slice(0, 8) : [],
    requiredFixes: Array.isArray(payload?.requiredFixes) ? payload.requiredFixes.map(String).slice(0, 8) : [],
    verdict: payload?.verdict === "approve" ? "approve" : "needs-fixes",
  };
}

function knownFactsMarkdown(coordinator) {
  const sections = coordinator.knownFacts.map((item) => {
    const facts = Array.isArray(item?.facts) ? item.facts.map((fact) => `- ${fact}`).join("\n") : "- No facts recorded.";
    return `## ${item?.theme || "Theme"}\n${facts}`;
  });
  return `# Known Facts\n\n${sections.join("\n\n") || "No facts were consolidated."}\n`;
}

function planMarkdown(config) {
  return `# Deep Research RO Run\n\n- **Topic:** ${config.topic}\n- **Workers:** ${config.agents}\n- **Round 2:** ${config.singleRound ? "disabled" : "gap-driven"}\n- **Model:** ${config.model || "Pi default"}\n- **Worker timeout:** ${config.timeoutMs} ms\n\n## Stages\n\n1. Split the topic into non-overlapping angles.\n2. Research each angle in isolated headless Pi sessions.\n3. Coordinate evidence, gaps, and contradictions.\n4. Fill material gaps in a second isolated round.\n5. Record worker fetch evidence and verify each resulting URL's reachability.\n6. Synthesize only URLs submitted to completed non-error fetch/extract calls and confirmed reachable.\n7. Independently judge the report.\n`;
}

async function writeState(outputDir, state) {
  state.updatedAt = now();
  await writeJson(join(outputDir, "state.json"), state);
}

async function updateMetrics(outputDir, metrics) {
  metrics.finishedAt = now();
  metrics.durationMs = Date.now() - metrics.startedEpochMs;
  await writeJson(join(outputDir, "metrics.json"), metrics);
}

function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) return true;
    const mappedV4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedV4 ? isPrivateAddress(mappedV4) : false;
  }
  return true;
}

async function resolveSafeUrl(rawUrl, allowPrivateSources) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(`Unsupported source protocol: ${url.protocol}`);
  const hostname = url.hostname.toLowerCase();
  if (!allowPrivateSources && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "metadata.google.internal")) {
    fail(`Private hostname blocked: ${hostname}`);
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || (!allowPrivateSources && addresses.some((entry) => isPrivateAddress(entry.address)))) {
    fail(`Private or unresolved source address blocked: ${hostname}`);
  }
  return { url, address: addresses[0] };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function requestBounded(url, address, timeoutMs) {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let absoluteTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimer);
      callback(value);
    };
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.hostname,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; pi-deep-research-ro/1.0)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
        range: "bytes=0-4096",
      },
      // Node may request all addresses (for its connection racing path); preserve that callback shape.
      lookup: (_hostname, options, callback) => callback(
        null,
        options?.all ? [address] : address.address,
        options?.all ? undefined : address.family,
      ),
    }, (response) => {
      let bytesRead = 0;
      const complete = () => finish(resolveRequest, { status: response.statusCode || 0, headers: response.headers, bytesRead });
      response.on("data", (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead >= 4096) {
          response.destroy();
          complete();
        }
      });
      response.once("end", complete);
      response.once("close", complete);
      response.once("error", (error) => finish(rejectRequest, error));
    });
    absoluteTimer = setTimeout(() => request.destroy(new Error("timeout")), timeoutMs);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
    request.once("error", (error) => finish(rejectRequest, error));
    request.end();
  });
}

async function verifyUrl(originalUrl, config) {
  const deadline = Date.now() + Math.min(config.timeoutMs, 30_000);
  let currentUrl = originalUrl;
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { url: originalUrl, status: null, classification: "BLOCKED", note: "timeout" };
      const safe = await withTimeout(resolveSafeUrl(currentUrl, config.allowPrivateSources), remainingMs);
      const response = await requestBounded(safe.url, safe.address, remainingMs);
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        currentUrl = new URL(Array.isArray(location) ? location[0] : location, safe.url).toString();
        continue;
      }
      const classification = response.status >= 200 && response.status < 300
        ? "OK"
        : response.status === 404 || response.status === 410
          ? "DEAD"
          : "BLOCKED";
      return {
        url: originalUrl,
        status: response.status,
        finalUrl: safe.url.toString(),
        classification,
        bytesRead: response.bytesRead,
        contentType: Array.isArray(response.headers["content-type"]) ? response.headers["content-type"][0] : response.headers["content-type"] || null,
      };
    }
    return { url: originalUrl, status: null, classification: "BLOCKED", note: "too many redirects" };
  } catch (error) {
    return { url: originalUrl, status: null, classification: "BLOCKED", note: String(error?.message || error) };
  }
}

async function verifyUrls(urls, config) {
  return mapConcurrent(urls, Math.min(10, config.concurrency * 3), (url) => verifyUrl(url, config));
}

function auditCitations(report, verification, evidenceUrls) {
  const citations = urlsInText(report);
  const valid = new Set(verification.filter((entry) => entry.classification === "OK").map((entry) => entry.url));
  const evidence = new Set(evidenceUrls);
  return {
    citations,
    invalid: citations.filter((url) => !valid.has(url)),
    notInEvidence: citations.filter((url) => !evidence.has(url)),
    verifiedCitationCount: citations.filter((url) => valid.has(url)).length,
  };
}

async function initialise(options) {
  if (options.resume) {
    const configPath = join(options.resume, "config.json");
    if (!existsSync(configPath)) fail(`No config.json found in ${options.resume}`);
    const saved = await readJson(configPath);
    return { outputDir: options.resume, config: saved.config, resumed: true };
  }

  const topic = options.topic.trim();
  const outputDir = options.output || join(process.env.HOME || process.cwd(), "Documents", "Research", "ro-runs", runId(topic));
  if (existsSync(outputDir)) fail(`Output directory already exists: ${outputDir}. Use --resume to continue it.`);
  await ensureDir(outputDir);
  const config = { ...options, topic, workerCwd: process.cwd(), output: undefined, resume: undefined };
  await writeJson(join(outputDir, "config.json"), { version: VERSION, createdAt: now(), config });
  await writeAtomic(join(outputDir, "plan.md"), planMarkdown(config));
  await writeState(outputDir, { version: VERSION, topic, createdAt: now(), phases: {} });
  return { outputDir, config, resumed: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { outputDir, config, resumed } = await initialise(options);
  const metrics = existsSync(join(outputDir, "metrics.json"))
    ? await readJson(join(outputDir, "metrics.json"))
    : { version: VERSION, startedAt: now(), startedEpochMs: Date.now(), workers: [], failures: [] };
  metrics.startedEpochMs ||= Date.now();
  const state = existsSync(join(outputDir, "state.json"))
    ? await readJson(join(outputDir, "state.json"))
    : { version: VERSION, topic: config.topic, createdAt: now(), phases: {} };

  const mark = async (phase, status, details = {}) => {
    state.phases[phase] = { status, at: now(), ...details };
    await writeState(outputDir, state);
    await updateMetrics(outputDir, metrics);
  };

  if (config.dryRun && !resumed) {
    await mark("plan", "complete", { dryRun: true });
    console.log(JSON.stringify({ outputDir, dryRun: true, plan: join(outputDir, "plan.md") }));
    return;
  }

  try {
    const anglesPath = join(outputDir, "angles.json");
    let angles;
    if (existsSync(anglesPath)) {
      angles = normaliseAngles(await readJson(anglesPath), config.agents);
      await writeJson(anglesPath, angles);
    } else {
      await mark("split", "running");
      const split = await runWithRetry({
        config,
        outputDir,
        label: "split",
        prompt: splitPrompt(config.topic, config.agents),
        metrics,
      });
      angles = normaliseAngles(split.value, config.agents);
      await writeJson(anglesPath, angles);
      await mark("split", "complete", { angles: angles.length });
    }

    const round1Dir = join(outputDir, "round-1");
    await ensureDir(round1Dir);
    await mark("round1", "running");
    const round1 = await mapConcurrent(angles, config.concurrency, async (angle) => {
      const path = phaseArtifactPath(round1Dir, angle.id);
      if (existsSync(path)) {
        const saved = await readJson(path);
        return normaliseFindings(saved, angle.id, saved.fetchedUrls || []);
      }
      const result = await runWithRetry({
        config,
        outputDir,
        label: `r1-${angle.id}`,
        prompt: researcherPrompt({ topic: config.topic, angle, round: 1 }),
        metrics,
      });
      const findings = normaliseFindings(result.value, angle.id, result.fetchedUrls);
      await writeJson(path, findings);
      return findings;
    });
    await mark("round1", "complete", { workers: round1.length });

    const sharedDir = join(outputDir, "shared");
    await ensureDir(sharedDir);
    const coordinatorPath = join(sharedDir, "coordinator.json");
    let coordinator;
    if (existsSync(coordinatorPath)) {
      coordinator = normaliseCoordinator(await readJson(coordinatorPath));
      await writeJson(coordinatorPath, coordinator);
    } else {
      await mark("coordinate", "running");
      const result = await runWithRetry({
        config,
        outputDir,
        label: "coordinate",
        prompt: coordinatorPrompt(config.topic, round1),
        metrics,
      });
      coordinator = normaliseCoordinator(result.value);
      await writeJson(coordinatorPath, coordinator);
      await writeAtomic(join(sharedDir, "known-facts.md"), knownFactsMarkdown(coordinator));
      await writeJson(join(sharedDir, "gaps.json"), coordinator.gaps);
      await writeJson(join(sharedDir, "contradictions.json"), coordinator.contradictions);
      await mark("coordinate", "complete", { gaps: coordinator.gaps.length });
    }

    const round2Dir = join(outputDir, "round-2");
    await ensureDir(round2Dir);
    let round2 = [];
    const selectedGaps = config.singleRound ? [] : coordinator.gaps.slice(0, config.agents);
    if (selectedGaps.length > 0) {
      await mark("round2", "running", { gaps: selectedGaps.length });
      const shared = { knownFacts: coordinator.knownFacts, sources: uniqueUrls(round1.flatMap((entry) => entry.sources)) };
      round2 = await mapConcurrent(selectedGaps, config.concurrency, async (gap) => {
        const path = phaseArtifactPath(round2Dir, gap.id);
        if (existsSync(path)) {
          const saved = await readJson(path);
          return normaliseFindings(saved, gap.id, saved.fetchedUrls || []);
        }
        const result = await runWithRetry({
          config,
          outputDir,
          label: `r2-${gap.id}`,
          prompt: researcherPrompt({ topic: config.topic, angle: gap, round: 2, shared }),
          metrics,
        });
        const findings = normaliseFindings(result.value, gap.id, result.fetchedUrls);
        await writeJson(path, findings);
        return findings;
      });
      await mark("round2", "complete", { workers: round2.length });
    } else {
      await mark("round2", "skipped", { reason: config.singleRound ? "single-round mode" : "no material gaps" });
    }

    const allFindings = [...round1, ...round2];
    const sourceUrls = uniqueUrls(allFindings.flatMap((entry) => entry.sources));
    await writeJson(join(sharedDir, "sources.json"), sourceUrls);
    await writeJson(join(sharedDir, "source-evidence.json"), allFindings.map((entry) => ({
      scope: entry.scope,
      citedSources: entry.sources,
      toolObservedFetches: entry.fetchedUrls,
      failedSources: entry.failedSources,
    })));

    const verificationPath = join(outputDir, "citation-verification.json");
    let verification;
    if (existsSync(verificationPath)) {
      verification = await readJson(verificationPath);
    } else {
      await mark("verify", "running", { sources: sourceUrls.length });
      verification = await verifyUrls(sourceUrls, config);
      await writeJson(verificationPath, verification);
      await mark("verify", "complete", {
        ok: verification.filter((entry) => entry.classification === "OK").length,
        dead: verification.filter((entry) => entry.classification === "DEAD").length,
        blocked: verification.filter((entry) => entry.classification === "BLOCKED").length,
      });
    }

    const reportPath = join(outputDir, "report.md");
    let report = existsSync(reportPath) ? await readFile(reportPath, "utf8") : null;
    if (!report) {
      await mark("synthesize", "running");
      const result = await runWithRetry({
        config,
        outputDir,
        label: "synthesize",
        prompt: synthesizerPrompt({ topic: config.topic, findings: allFindings, verification, rounds: round2.length ? 2 : 1 }),
        metrics,
        expectJson: false,
      });
      report = result.value;
      await writeAtomic(reportPath, `${report.trim()}\n`);
      await mark("synthesize", "complete");
    }

    const auditPath = join(outputDir, "citation-audit.json");
    let citationAudit = auditCitations(report, verification, sourceUrls);
    if (citationAudit.invalid.length > 0) {
      await mark("repair-citations", "running", { invalid: citationAudit.invalid.length });
      const result = await runWithRetry({
        config,
        outputDir,
        label: "repair-citations",
        prompt: repairPrompt({
          report,
          validUrls: verification.filter((entry) => entry.classification === "OK").map((entry) => entry.url),
          invalidUrls: citationAudit.invalid,
        }),
        metrics,
        expectJson: false,
      });
      report = result.value;
      await writeAtomic(reportPath, `${report.trim()}\n`);
      citationAudit = auditCitations(report, verification, sourceUrls);
      await mark("repair-citations", citationAudit.invalid.length === 0 ? "complete" : "incomplete", { invalidRemaining: citationAudit.invalid.length });
    }
    await writeJson(auditPath, citationAudit);
    if (citationAudit.invalid.length > 0 || citationAudit.notInEvidence.length > 0) {
      fail(`Citation repair failed: ${citationAudit.invalid.length} invalid and ${citationAudit.notInEvidence.length} non-evidence citation(s) remain`);
    }

    const judgePath = join(outputDir, "judge.json");
    let judge;
    if (existsSync(judgePath)) {
      judge = await readJson(judgePath);
    } else {
      await mark("judge", "running");
      const result = await runWithRetry({
        config,
        outputDir,
        label: "judge",
        prompt: judgePrompt({ topic: config.topic, report, citationAudit }),
        metrics,
      });
      judge = normaliseJudge(result.value);
      await writeJson(judgePath, judge);
      await mark("judge", "complete", { verdict: judge.verdict, overall: judge.overall });
    }

    await mark("complete", "complete", { report: "report.md", judge: judge.verdict });
    await updateMetrics(outputDir, metrics);
    console.log(JSON.stringify({
      outputDir,
      report: reportPath,
      judge: judgePath,
      verdict: judge.verdict,
      score: judge.overall,
      resumed,
    }));
  } catch (error) {
    await mark("failed", "failed", { error: error.message });
    console.error(`[deep-research-ro] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

main();
