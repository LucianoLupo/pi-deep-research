import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const repository = resolve(import.meta.dirname, "../..");
const orchestrator = join(repository, "ro", "orchestrate.mjs");
const fakePi = join(repository, "ro", "test", "fake-pi.mjs");

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { env: { ...process.env, ...options.env }, cwd: options.cwd || repository });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

async function withServer(callback) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("verified fixture source");
  });
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const { port } = server.address();
  try {
    return await callback(`http://localhost:${port}/source`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function workflowArgs(output, extra = []) {
  return [orchestrator, "fixture topic", "--agents", "2", "--output", output, "--pi-bin", fakePi, "--retries", "0", ...extra];
}

test("dry run creates only durable planning artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-ro-dry-"));
  const output = join(root, "run");
  const result = await run(process.execPath, [orchestrator, "fixture topic", "--agents", "2", "--dry-run", "--output", output, "--pi-bin", fakePi]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).dryRun, true);
  const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
  const state = JSON.parse(await readFile(join(output, "state.json"), "utf8"));
  assert.equal(config.config.topic, "fixture topic");
  assert.equal(state.phases.plan.status, "complete");
  await assert.rejects(readFile(join(output, "angles.json"), "utf8"));
});

test("full workflow isolates workers, verifies URLs, and resumes without rerunning completed phases", async () => {
  await chmod(fakePi, 0o755);
  const root = await mkdtemp(join(tmpdir(), "pi-ro-full-"));
  const output = join(root, "run");
  const trace = join(root, "trace.log");

  await withServer(async (sourceUrl) => {
    const env = { FAKE_SOURCE_URL: sourceUrl, FAKE_TRACE: trace, FAKE_WAIT_FOR_STDIN_EOF: "1" };
    const first = await run(process.execPath, workflowArgs(output, ["--timeout-ms", "10000", "--allow-private-sources"]), { env });
    assert.equal(first.code, 0, first.stderr);
    const summary = JSON.parse(first.stdout);
    assert.equal(summary.verdict, "approve");

    const angles = JSON.parse(await readFile(join(output, "angles.json"), "utf8"));
    assert.equal(angles[0].id, "architecture");
    const evidence = JSON.parse(await readFile(join(output, "shared", "source-evidence.json"), "utf8"));
    assert.equal(evidence[0].toolObservedFetches[0], sourceUrl);
    const verification = JSON.parse(await readFile(join(output, "citation-verification.json"), "utf8"));
    assert.equal(verification.length, 1);
    assert.equal(verification[0].classification, "OK");
    const audit = JSON.parse(await readFile(join(output, "citation-audit.json"), "utf8"));
    assert.deepEqual(audit.invalid, []);
    const report = await readFile(join(output, "report.md"), "utf8");
    assert.match(report, new RegExp(sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const judge = JSON.parse(await readFile(join(output, "judge.json"), "utf8"));
    assert.equal(judge.verdict, "approve");

    const traceBeforeResume = await readFile(trace, "utf8");
    const resumed = await run(process.execPath, [orchestrator, "--resume", output], { env });
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).resumed, true);
    assert.equal(await readFile(trace, "utf8"), traceBeforeResume);
  });
});

test("blocks private source verification unless the testing-only opt-in is set", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-ro-private-"));
  const output = join(root, "run");

  await withServer(async (sourceUrl) => {
    const result = await run(process.execPath, workflowArgs(output), { env: { FAKE_SOURCE_URL: sourceUrl } });
    assert.equal(result.code, 1);
    const verification = JSON.parse(await readFile(join(output, "citation-verification.json"), "utf8"));
    assert.equal(verification[0].classification, "BLOCKED");
    assert.match(verification[0].note, /Private/);
  });
});

test("fails closed for malformed worker JSONL and force-kills a timed-out worker", async () => {
  const malformedRoot = await mkdtemp(join(tmpdir(), "pi-ro-malformed-"));
  const malformedOutput = join(malformedRoot, "run");
  const malformed = await run(process.execPath, workflowArgs(malformedOutput), { env: { FAKE_MALFORMED_PHASE: "research-1" } });
  assert.equal(malformed.code, 1);
  assert.match(await readFile(join(malformedOutput, "logs", "r1-architecture.jsonl"), "utf8"), /not-json/);

  const timeoutRoot = await mkdtemp(join(tmpdir(), "pi-ro-timeout-"));
  const timeoutOutput = join(timeoutRoot, "run");
  const startedAt = Date.now();
  const timedOut = await run(process.execPath, workflowArgs(timeoutOutput, ["--timeout-ms", "1000", "--kill-grace-ms", "100"]), {
    env: { FAKE_HANG_PHASE: "split" },
  });
  assert.equal(timedOut.code, 1);
  assert.ok(Date.now() - startedAt < 5_000, "timed-out worker should be force-killed promptly");
});

test("refuses to produce a judged report when citation repair leaves invalid URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-ro-citation-"));
  const output = join(root, "run");

  await withServer(async (sourceUrl) => {
    const result = await run(process.execPath, workflowArgs(output, ["--allow-private-sources"]), {
      env: { FAKE_SOURCE_URL: sourceUrl, FAKE_INVALID_SYNTHESIS: "1", FAKE_BAD_REPAIR: "1" },
    });
    assert.equal(result.code, 1);
    const audit = JSON.parse(await readFile(join(output, "citation-audit.json"), "utf8"));
    assert.ok(audit.invalid.length > 0);
    await assert.rejects(readFile(join(output, "judge.json"), "utf8"));
  });
});
