import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ensureBridge, stopBridgeServer } from "./bridge.ts";
import { searchGoogle } from "./search.ts";
import { fetchAllContent } from "./extract.ts";
import {
  ENTRY_TYPE,
  storeResult,
  getResult,
  getResultByUrl,
  getResultByQuery,
  listResults,
  restoreFromSession,
  clearAll,
  type StoredResearchData,
  type ExtractedContent,
} from "./storage.ts";
// #28: Formatters extracted to format.ts
import { formatSearchResults, formatExtractedContent } from "./format.ts";

let sessionActive = false;
const pendingFetches = new Map<string, AbortController>();
let piRef: ExtensionAPI | null = null;

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function abortPendingFetches(): void {
  for (const [_id, controller] of pendingFetches) {
    controller.abort();
  }
  pendingFetches.clear();
}

// #18: Typed ctx parameter
function handleSessionChange(ctx: ExtensionContext): void {
  abortPendingFetches();
  clearAll();
  const restored = restoreFromSession(ctx);
  if (restored > 0) {
    ctx.ui.notify(`Restored ${restored} cached research results`, "info");
  }
}

function startBackgroundFetch(urls: string[], useJina: boolean): string {
  // #13: Guard piRef with runtime check
  if (!piRef) throw new Error("Extension not initialized");
  const pi = piRef;
  const fetchId = generateId();
  const controller = new AbortController();
  pendingFetches.set(fetchId, controller);

  fetchAllContent(urls, controller.signal, undefined, useJina)
    .then((fetched) => {
      if (!sessionActive || !pendingFetches.has(fetchId)) return;
      const data: StoredResearchData = {
        id: fetchId,
        type: "fetch",
        timestamp: Date.now(),
        urls: fetched,
      };
      storeResult(fetchId, data);
      pi.appendEntry(ENTRY_TYPE, data);
      const ok = fetched.filter((f) => !f.error).length;
      pi.sendMessage(
        {
          customType: "deep-research-content-ready",
          content: `Background fetch complete: ${ok}/${fetched.length} URLs extracted successfully [${fetchId}].`,
          display: true,
        },
        { triggerTurn: true },
      );
    })
    .catch((err) => {
      if (!sessionActive || !pendingFetches.has(fetchId)) return;
      if (err.name !== "AbortError") {
        pi.sendMessage(
          {
            customType: "deep-research-error",
            content: `Background fetch failed [${fetchId}]: ${err.message}`,
            display: true,
          },
          { triggerTurn: false },
        );
      }
    })
    .finally(() => {
      pendingFetches.delete(fetchId);
    });

  return fetchId;
}

export default function (pi: ExtensionAPI): void {
  piRef = pi;

  // #24: Consolidate session handlers
  for (const event of ["session_start", "session_switch", "session_fork", "session_tree"] as const) {
    pi.on(event, (_e, ctx) => {
      sessionActive = true;
      handleSessionChange(ctx);
    });
  }

  pi.on("session_shutdown", () => {
    sessionActive = false;
    abortPendingFetches();
    clearAll();
    stopBridgeServer();
  });

  // --- Tools ---

  pi.registerTool({
    name: "research_search",
    label: "Research Search",
    description:
      "Search Google via Chrome bridge. Results are cached and persisted. " +
      "Rate-limited to avoid CAPTCHA. Prefer this over chrome_web_search for research workflows.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(
        Type.Number({ description: "Number of results (default 10)", default: 10 }),
      ),
      fetchContent: Type.Optional(
        Type.Boolean({
          description:
            "Auto-fetch content from result URLs in background (default false)",
          default: false,
        }),
      ),
      useJina: Type.Optional(
        Type.Boolean({
          description: "Enable Jina Reader as fallback for content extraction (default false)",
          default: false,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { query, numResults = 10, fetchContent = false, useJina = false } = params;

      // Check cache first
      // #20: renamed queries -> searchResults
      const cached = getResultByQuery(query);
      if (cached?.searchResults) {
        let text = `**Cached results for "${query}"** [${cached.id}]\n\n`;
        text += formatSearchResults(cached.searchResults);
        return { content: [{ type: "text", text }] };
      }

      if (!(await ensureBridge())) {
        return {
          content: [
            {
              type: "text",
              text: "Chrome bridge unavailable. Ensure pi-chrome extension is installed and Chrome is running.",
            },
          ],
          isError: true,
        };
      }

      const response = await searchGoogle(query, numResults, signal);

      if (response.captcha) {
        return {
          content: [
            {
              type: "text",
              text: "Google CAPTCHA detected. Wait a few minutes before searching again, or reduce search frequency.",
            },
          ],
          isError: true,
        };
      }

      if (response.error) {
        return {
          content: [{ type: "text", text: `Search error: ${response.error}` }],
          isError: true,
        };
      }

      // Store results (#20: searchResults instead of queries)
      const id = generateId();
      const data: StoredResearchData = {
        id,
        type: "search",
        timestamp: Date.now(),
        query,
        searchResults: response.results,
      };
      storeResult(id, data);
      pi.appendEntry(ENTRY_TYPE, data);

      let fetchNote = "";
      if (fetchContent && response.results.length > 0) {
        const urls = response.results.map((r) => r.url);
        const fetchId = startBackgroundFetch(urls, useJina);
        fetchNote = `\n\n*Background fetch started [${fetchId}] -- content will arrive shortly.*`;
      }

      let text = `**Search results for "${query}"** [${id}]\n\n`;
      text += formatSearchResults(response.results);
      text += fetchNote;

      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "research_fetch",
    label: "Research Fetch",
    description:
      "Fetch and extract content from URLs. Uses HTTP+Readability (fast) with " +
      "Chrome browser fallback. Optionally enable Jina Reader fallback. Returns clean markdown.",
    parameters: Type.Object({
      urls: Type.Array(Type.String(), {
        description: "URLs to fetch and extract content from",
      }),
      method: Type.Optional(
        Type.Union(
          [
            Type.Literal("auto"),
            Type.Literal("http"),
            Type.Literal("chrome"),
          ],
          {
            description:
              "Extraction method: auto (default, uses fallback chain), http (Node.js only), chrome (browser only)",
            default: "auto",
          },
        ),
      ),
      // #12: Jina opt-in parameter
      useJina: Type.Optional(
        Type.Boolean({
          description: "Enable Jina Reader as fallback method (default false)",
          default: false,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const { urls, method = "auto", useJina = false } = params;

      const results: ExtractedContent[] = [];
      const toFetch: string[] = [];

      for (const url of urls) {
        const cached = getResultByUrl(url);
        if (cached?.urls) {
          const item = cached.urls.find((u) => u.url === url);
          if (item) {
            results.push(item);
            continue;
          }
        }
        toFetch.push(url);
      }

      if (toFetch.length > 0) {
        const fetched = await fetchAllContent(toFetch, signal, method, useJina);
        results.push(...fetched);

        const id = generateId();
        const data: StoredResearchData = {
          id,
          type: "fetch",
          timestamp: Date.now(),
          urls: fetched,
        };
        storeResult(id, data);
        pi.appendEntry(ENTRY_TYPE, data);
      }

      const text = formatExtractedContent(results);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "research_get_content",
    label: "Research Get Content",
    description:
      "Retrieve previously fetched content by ID, URL, or query. " +
      "Returns full cached content without re-fetching.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Result ID to look up" })),
      url: Type.Optional(Type.String({ description: "URL to look up" })),
      query: Type.Optional(Type.String({ description: "Search query to look up" })),
    }),
    async execute(_toolCallId, params) {
      const { id, url, query } = params;

      let result: StoredResearchData | undefined;

      if (id) result = getResult(id);
      else if (url) result = getResultByUrl(url);
      else if (query) result = getResultByQuery(query);

      if (!result) {
        const all = listResults();
        if (all.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No cached research results found. Use research_search or research_fetch first.",
              },
            ],
          };
        }

        let text = "**Content not found.** Available results:\n\n";
        text += all
          .map(
            (r) =>
              `- \`${r.id}\` (${r.type}) ${r.summary} -- ${new Date(r.timestamp).toISOString()}`,
          )
          .join("\n");
        return { content: [{ type: "text", text }] };
      }

      // #20: searchResults instead of queries
      if (result.type === "search" && result.searchResults) {
        let text = `**Search results** [${result.id}]: "${result.query}"\n\n`;
        text += formatSearchResults(result.searchResults);
        return { content: [{ type: "text", text }] };
      }

      if (result.type === "fetch" && result.urls) {
        const text = formatExtractedContent(result.urls);
        return { content: [{ type: "text", text }] };
      }

      return {
        content: [{ type: "text", text: `Result [${result.id}] has no content.` }],
      };
    },
  });

  pi.registerTool({
    name: "research_list",
    label: "Research List",
    description:
      "List all cached research results with IDs and metadata. " +
      "Use research_get_content to retrieve full content by ID.",
    parameters: Type.Object({
      type: Type.Optional(
        Type.Union([Type.Literal("search"), Type.Literal("fetch")], {
          description: "Filter by type: search or fetch",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const results = listResults(params.type);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No cached research results. Use research_search or research_fetch to get started.",
            },
          ],
        };
      }

      let text = `**Cached research results** (${results.length})\n\n`;
      text += results
        .map(
          (r) =>
            `- \`${r.id}\` **${r.type}** ${r.summary}${r.hasErrors ? " -- has errors" : ""} -- ${new Date(r.timestamp).toISOString()}`,
        )
        .join("\n");

      return { content: [{ type: "text", text }] };
    },
  });
}
