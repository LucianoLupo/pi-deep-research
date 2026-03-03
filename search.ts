import { makeBridgeRequest } from "./bridge.ts";
import type { SearchResult } from "./storage.ts";

const MIN_SEARCH_INTERVAL_MS = 3000;
const CAPTCHA_PATTERNS =
  /google\.com\/sorry|recaptcha|unusual traffic|captcha/i;

let lastSearchTime = 0;
// #16: Escalating CAPTCHA backoff
let captchaBackoffMs = 0;

export interface SearchResponse {
  results: SearchResult[];
  error: string | null;
  captcha?: boolean;
}

export async function searchGoogle(
  query: string,
  numResults = 10,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  // Rate limit
  const now = Date.now();
  const wait = Math.max(0, lastSearchTime + MIN_SEARCH_INTERVAL_MS + captchaBackoffMs - now);
  // #15: Abort-aware rate limit delay
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
  lastSearchTime = Date.now();

  try {
    const response = await makeBridgeRequest(
      "webSearch",
      { query, numResults, background: true },
      signal,
    );

    if (!response) {
      return { results: [], error: "No response from bridge" };
    }

    // CAPTCHA detection on error string
    if (response.error && CAPTCHA_PATTERNS.test(response.error)) {
      // #16: Escalating backoff after CAPTCHA
      captchaBackoffMs = Math.min(120000, Math.max(30000, captchaBackoffMs * 2 || 30000));
      lastSearchTime = Date.now() + captchaBackoffMs;
      return { results: [], error: "captcha_detected", captcha: true };
    }

    // #26: Direct field test instead of JSON.stringify
    if (
      response.results?.some(
        (r: any) =>
          CAPTCHA_PATTERNS.test(r.url || "") ||
          CAPTCHA_PATTERNS.test(r.title || "") ||
          CAPTCHA_PATTERNS.test(r.snippet || ""),
      )
    ) {
      captchaBackoffMs = Math.min(120000, Math.max(30000, captchaBackoffMs * 2 || 30000));
      lastSearchTime = Date.now() + captchaBackoffMs;
      return { results: [], error: "captcha_detected", captcha: true };
    }

    if (!response.ok) {
      return { results: [], error: response.error || "Search failed" };
    }

    const results: SearchResult[] = (response.results || []).map(
      (r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.snippet || "",
      }),
    );

    // #16: Reset backoff on successful search
    captchaBackoffMs = 0;

    return { results, error: null };
  } catch (err: any) {
    return { results: [], error: err.message || "Search request failed" };
  }
}
