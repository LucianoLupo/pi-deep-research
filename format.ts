import type { ExtractedContent } from "./storage.ts";

// #28: Extracted from index.ts

export function formatSearchResults(
  results: { title: string; url: string; snippet: string }[],
): string {
  if (results.length === 0) return "No results found.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

// #5: Wrap extracted content in untrusted content markers
export function formatExtractedContent(items: ExtractedContent[]): string {
  return items
    .map((item) => {
      if (item.error) {
        return `## ${item.url}\n**Error:** ${item.error}`;
      }
      const meta = [
        `**URL:** ${item.url}`,
        `**Title:** ${item.title}`,
        `**Method:** ${item.method}`,
        `**Words:** ${item.wordCount}`,
        item.author ? `**Author:** ${item.author}` : null,
        item.date ? `**Date:** ${item.date}` : null,
        item.likelyPaywall ? "**Warning: Likely paywalled**" : null,
        item.likelyJSRendered ? "**Warning: May need JS rendering**" : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `## ${item.title}\n${meta}\n\n<extracted_content source="web" url="${item.url}" trust="untrusted">\n${item.content}\n</extracted_content>`;
    })
    .join("\n\n---\n\n");
}
