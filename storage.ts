import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export const ENTRY_TYPE = "deep-research-results";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// #9: LRU eviction cap
const MAX_STORE_ENTRIES = 200;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  author?: string;
  date?: string;
  excerpt?: string;
  method: "http-readability" | "jina" | "chrome";
  error: string | null;
  likelyPaywall?: boolean;
  likelyJSRendered?: boolean;
}

export interface StoredResearchData {
  id: string;
  type: "search" | "fetch";
  timestamp: number;
  query?: string;
  // #20: Renamed from `queries` to `searchResults`
  searchResults?: SearchResult[];
  urls?: ExtractedContent[];
}

interface ResultSummary {
  id: string;
  type: "search" | "fetch";
  timestamp: number;
  summary: string;
  hasErrors: boolean;
}

const store = new Map<string, StoredResearchData>();

// #9: LRU eviction on overflow
export function storeResult(id: string, data: StoredResearchData): void {
  if (store.size >= MAX_STORE_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, val] of store) {
      if (val.timestamp < oldestTime) {
        oldestTime = val.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }
  store.set(id, data);
}

export function getResult(id: string): StoredResearchData | undefined {
  return store.get(id);
}

export function getResultByUrl(url: string): StoredResearchData | undefined {
  for (const data of store.values()) {
    if (data.urls?.some((u) => u.url === url)) return data;
  }
  return undefined;
}

export function getResultByQuery(query: string): StoredResearchData | undefined {
  const q = query.toLowerCase();
  for (const data of store.values()) {
    if (data.query?.toLowerCase() === q) return data;
  }
  return undefined;
}

export function listResults(filter?: "search" | "fetch"): ResultSummary[] {
  const results: ResultSummary[] = [];
  for (const data of store.values()) {
    if (filter && data.type !== filter) continue;
    results.push({
      id: data.id,
      type: data.type,
      timestamp: data.timestamp,
      summary: summarize(data),
      hasErrors: hasErrors(data),
    });
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

// #22: O(n) scan is inherent to the session format. The LRU cap (MAX_STORE_ENTRIES)
// limits the data volume, making this acceptable for the expected dataset size.
export function restoreFromSession(ctx: ExtensionContext): number {
  const branch = ctx.sessionManager.getBranch();
  const cutoff = Date.now() - CACHE_TTL_MS;
  let restored = 0;

  for (const entry of branch) {
    if (
      entry.type !== "custom" ||
      !("customType" in entry) ||
      (entry as any).customType !== ENTRY_TYPE
    )
      continue;

    const data = (entry as any).data as StoredResearchData | undefined;
    if (!data || !isValidStoredData(data)) continue;
    if (data.timestamp < cutoff) continue;

    store.set(data.id, data);
    restored++;
  }

  return restored;
}

export function clearAll(): void {
  store.clear();
}

function isValidStoredData(data: unknown): data is StoredResearchData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    (d.type === "search" || d.type === "fetch") &&
    typeof d.timestamp === "number"
  );
}

function summarize(data: StoredResearchData): string {
  if (data.type === "search") {
    return `Search: "${data.query || "?"}" → ${data.searchResults?.length ?? 0} results`;
  }
  const count = data.urls?.length ?? 0;
  const first = data.urls?.[0]?.url ?? "?";
  return `Fetch: ${count} URL${count !== 1 ? "s" : ""} (${first})`;
}

function hasErrors(data: StoredResearchData): boolean {
  if (data.type === "fetch") {
    return data.urls?.some((u) => u.error !== null) ?? false;
  }
  return false;
}
