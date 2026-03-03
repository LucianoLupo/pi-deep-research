import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import pLimit from "p-limit";
import { makeBridgeRequest } from "./bridge.ts";
import type { ExtractedContent } from "./storage.ts";

const limit = pLimit(5);
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT = 30000;
const PAYWALL_PATTERN = /subscribe|sign.?in|members.?only|paywall/i;
const MIN_READABILITY_CHARS = 500;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

// #25: TurndownService singleton
const turndownService = new TurndownService({ headingStyle: "atx" });

// #2: SSRF URL validation
const BLOCKED_HOSTS =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (BLOCKED_HOSTS.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// #23: Extract countWords utility
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// #3: Removed inFlight dedup — p-limit(5) provides concurrency control

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  forceMethod?: "auto" | "http" | "chrome",
  useJina = false,
): Promise<ExtractedContent> {
  return doExtract(url, forceMethod ?? "auto", signal, useJina);
}

export async function fetchAllContent(
  urls: string[],
  signal?: AbortSignal,
  forceMethod?: "auto" | "http" | "chrome",
  useJina = false,
): Promise<ExtractedContent[]> {
  return Promise.all(
    urls.map((url) => limit(() => extractContent(url, signal, forceMethod, useJina))),
  );
}

async function doExtract(
  url: string,
  method: "auto" | "http" | "chrome",
  signal?: AbortSignal,
  useJina = false,
): Promise<ExtractedContent> {
  // #2: SSRF check
  if (!isAllowedUrl(url)) {
    return makeError(url, "http-readability", `Blocked URL: only public http/https URLs are allowed`);
  }

  // Chrome-only path
  if (method === "chrome") {
    return extractViaChrome(url, signal);
  }

  const errors: string[] = [];

  // HTTP path (with fallbacks for auto)
  try {
    const result = await extractViaHttp(url, signal);
    if (result.error === null && !result.likelyJSRendered) return result;
    if (method === "http") return result;
    errors.push(`http: ${result.error || "JS-rendered page"}`);
  } catch (err: any) {
    errors.push(`http: ${err.message}`);
    if (method === "http") {
      return makeError(url, "http-readability", `HTTP fetch failed: ${err.message}`);
    }
  }

  // #12: Jina fallback only when opted in
  if (useJina) {
    try {
      const result = await extractViaJina(url, signal);
      if (result.error === null) return result;
      errors.push(`jina: ${result.error}`);
    } catch (err: any) {
      errors.push(`jina: ${err.message}`);
    }
  }

  // Fallback: Chrome batchExtract
  try {
    return await extractViaChrome(url, signal);
  } catch (err: any) {
    errors.push(`chrome: ${err.message}`);
    return makeError(url, "chrome", `All methods failed: ${errors.join("; ")}`);
  }
}

async function extractViaHttp(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });

  if (!res.ok) {
    // #11: Consume response body on error
    await res.body?.cancel();
    return makeError(url, "http-readability", `HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";

  // PDF -- can't extract in Node, flag for Chrome
  if (contentType.includes("application/pdf")) {
    await res.body?.cancel();
    return {
      url,
      title: url.split("/").pop() || url,
      content: "[PDF -- use chrome method for extraction]",
      wordCount: 0,
      method: "http-readability",
      error: null,
    };
  }

  // Non-HTML -- return raw text
  if (!contentType.includes("html")) {
    const text = await readBody(res, MAX_BODY_SIZE);
    const wc = countWords(text);
    return {
      url,
      title: url,
      content: text,
      wordCount: wc,
      method: "http-readability",
      error: null,
    };
  }

  // HTML -- Readability + Turndown
  const html = await readBody(res, MAX_BODY_SIZE);
  const { document } = parseHTML(html);

  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article) {
    return {
      url,
      title: document.title || url,
      content: "",
      wordCount: 0,
      method: "http-readability",
      error: null,
      likelyJSRendered: true,
    };
  }

  const markdown = turndownService.turndown(article.content);
  const wc = countWords(markdown);
  const likelyJSRendered = markdown.length < MIN_READABILITY_CHARS;
  const likelyPaywall =
    wc < 300 && PAYWALL_PATTERN.test(markdown + " " + html.slice(0, 5000));

  return {
    url,
    title: article.title || document.title || url,
    content: markdown,
    wordCount: wc,
    author: article.byline || undefined,
    excerpt: article.excerpt || undefined,
    method: "http-readability",
    error: null,
    likelyPaywall: likelyPaywall || undefined,
    likelyJSRendered: likelyJSRendered || undefined,
  };
}

async function extractViaJina(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  // #2: Don't leak internal URLs to Jina
  if (!isAllowedUrl(url)) {
    return makeError(url, "jina", "Blocked URL");
  }

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: "text/markdown",
      "X-No-Cache": "true",
    },
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    // #11: Consume response body on error
    await res.body?.cancel();
    return makeError(url, "jina", `Jina HTTP ${res.status}`);
  }

  const content = await res.text();
  const wc = countWords(content);

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] || url;

  return {
    url,
    title,
    content,
    wordCount: wc,
    method: "jina",
    error: null,
  };
}

async function extractViaChrome(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  const response = await makeBridgeRequest(
    "batchExtract",
    { urls: [url], concurrency: 1 },
    signal,
    20000,
  );

  if (!response?.ok || !response.results?.length) {
    return makeError(
      url,
      "chrome",
      response?.error || "Chrome extraction failed",
    );
  }

  const result = response.results[0];
  if (!result.ok) {
    return makeError(url, "chrome", result.error || "Chrome extraction failed");
  }

  const wc = countWords(result.content || "");

  return {
    url,
    title: result.title || url,
    content: result.content || "",
    wordCount: wc,
    author: result.author || undefined,
    date: result.date || undefined,
    excerpt: result.excerpt || undefined,
    method: "chrome",
    error: null,
  };
}

// #1: Streaming readBody with byte counting
// Also fixes #14 (NaN parseInt) and #19 (consistent truncation via early cancel)
async function readBody(res: Response, maxSize: number): Promise<string> {
  const contentLength = res.headers.get("content-length");
  const parsed = parseInt(contentLength ?? "", 10);
  if (!Number.isNaN(parsed) && parsed > maxSize) {
    await res.body?.cancel();
    throw new Error(`Response too large: ${contentLength} bytes`);
  }

  const reader = res.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let acceptedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (acceptedBytes + value.byteLength > maxSize) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
    acceptedBytes += value.byteLength;
  }
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return new TextDecoder().decode(chunks[0]);
  const combined = new Uint8Array(acceptedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function makeError(
  url: string,
  method: ExtractedContent["method"],
  error: string,
): ExtractedContent {
  return {
    url,
    title: url,
    content: "",
    wordCount: 0,
    method,
    error,
  };
}
