import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const BRIDGE_PORT = process.env.PI_CHROME_BRIDGE_PORT || "3773";
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`;
const BRIDGE_SERVER_DIR =
  process.env.PI_CHROME_BRIDGE_DIR ||
  resolve(process.env.HOME || "~", "projects/my-pi-extensions/pi-chrome/server");
const STARTUP_TIMEOUT_MS = 5000;
const HEALTH_POLL_MS = 250;

// #30: Validate bridge dir is under expected parent
const ALLOWED_BRIDGE_PARENTS = [
  resolve(process.env.HOME || "~", "projects"),
  resolve(process.env.HOME || "~", ".pi"),
];

function isValidBridgeDir(dir: string): boolean {
  const resolved = resolve(dir);
  return ALLOWED_BRIDGE_PARENTS.some((parent) => resolved.startsWith(parent + "/"));
}

let bridgeProcess: ChildProcess | null = null;

// #7: Typed bridge responses
interface BridgeResponse {
  ok: boolean;
  error?: string;
}

export interface BridgeSearchResponse extends BridgeResponse {
  results?: Array<{ title: string; url: string; snippet: string }>;
}

export interface BridgeExtractResponse extends BridgeResponse {
  results?: Array<{
    ok: boolean;
    error?: string;
    title?: string;
    content?: string;
    author?: string;
    date?: string;
    excerpt?: string;
  }>;
}

// #4: Shared promise for startup (replaces boolean `starting`)
let startupPromise: Promise<boolean> | null = null;

export async function ensureBridge(): Promise<boolean> {
  if (await checkBridgeHealth()) return true;
  return startBridgeServer();
}

async function startBridgeServer(): Promise<boolean> {
  if (startupPromise) return startupPromise;

  startupPromise = doStartBridge().finally(() => {
    startupPromise = null;
  });
  return startupPromise;
}

async function doStartBridge(): Promise<boolean> {
  // #30: Validate bridge directory
  if (!isValidBridgeDir(BRIDGE_SERVER_DIR)) {
    return false;
  }

  const indexPath = resolve(BRIDGE_SERVER_DIR, "index.js");
  if (!existsSync(indexPath)) {
    return false;
  }

  try {
    bridgeProcess = spawn("node", ["index.js"], {
      cwd: BRIDGE_SERVER_DIR,
      // #17: Don't pipe stdout/stderr -- nothing reads them
      stdio: ["ignore", "ignore", "ignore"],
      detached: false,
    });

    bridgeProcess.on("exit", () => {
      bridgeProcess = null;
    });

    bridgeProcess.unref();

    return await waitForHealthy();
  } catch {
    return false;
  }
}

async function waitForHealthy(): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkBridgeHealth()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

// #29: SIGKILL fallback
export function stopBridgeServer(): void {
  if (bridgeProcess) {
    const proc = bridgeProcess;
    bridgeProcess = null;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 3000);
  }
}

// #27: Removed unused isBridgeOwnedByUs

// #10: Explicit timeout parameter instead of smuggling in payload
// #8: Safe JSON parsing with res.ok check
// #21: Retry logic for transient errors
export async function makeBridgeRequest<T = any>(
  action: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  async function doRequest(): Promise<T> {
    const id = crypto.randomUUID();
    const res = await fetch(`${BRIDGE_URL}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, payload }),
      signal: signal ?? AbortSignal.timeout(timeoutMs + 5000),
    });

    // #8: Check res.ok before parsing JSON
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bridge HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`Bridge returned non-JSON (HTTP ${res.status})`);
    }
  }

  // #21: Single retry with 1s delay for connection errors
  try {
    return await doRequest();
  } catch (err: any) {
    if (isRetryableError(err)) {
      await new Promise((r) => setTimeout(r, 1000));
      return doRequest();
    }
    throw err;
  }
}

function isRetryableError(err: any): boolean {
  const msg = err?.message || "";
  return msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
}

export async function checkBridgeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
