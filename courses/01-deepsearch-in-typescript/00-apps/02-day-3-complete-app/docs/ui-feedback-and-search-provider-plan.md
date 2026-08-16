# UI Feedback & Search Provider Switching

> **Status:** Implemented — sources sent before summarization; `SEARCH_PROVIDER` toggles Tavily/Serper via `web-search.ts`.

## Current State

Most of the exercise is already implemented. Here is where we stand:

| Requirement | Status | Detail |
| --- | --- | --- |
| Research plan annotation (`data-research-plan`) | Done | Sent immediately after `queryRewriter` completes |
| Sources annotation (`data-sources`) | Done | Sent as a single deduplicated batch per loop iteration |
| Source cards UI (favicon, title, snippet grid) | Done | `Sources` component in `chat-message.tsx` |
| Sources shown as collapsible step | Done | Included in `ReasoningSteps` filter |
| Evaluator action annotation (`data-new-action`) | Done | Sent after `getNextAction` |
| Feedback display on continue | Done | "Continuing search..." + bordered feedback block |
| Discriminated union types | Done | `OurMessage` uses the v5 data-part map |

### Timing gap: sources arrive late

The one remaining issue from the exercise prompt is **when** sources reach the frontend relative to summarization.

Current flow in `run-agent-loop.ts`:

```
queryRewriter → ✅ send plan
  for each query (sequential):
    searchTavily
    collect sources
    summarizeSearchResults   ← blocks here per query
  ✅ send sources             ← only sent AFTER all summarization
  getNextAction → ✅ send action
```

The exercise says: send sources **before** summarization starts, as soon as search results are available. This is what the course solution (`06-final-app`) does.

### Serper/Tavily switching

Both providers are available. `SEARCH_PROVIDER` sets the **preferred** provider. On any error, the app automatically tries the other provider for that query.

---

## Implementation Plan

### 1. Send sources to the frontend before summarization

**File:** `run-agent-loop.ts`

Move the `data-sources` write to happen immediately after all search queries complete, before any summarization begins:

```
queryRewriter → ✅ send plan
  for each query (sequential):
    searchTavily / searchSerper
    collect sources + raw results
  ✅ send sources              ← MOVED: now before summarization
  summarize all results
  getNextAction → ✅ send action
```

This means:

- Collect search results across all queries first (dedup by URL, cap at `SCRAPE_URLS_COUNT`)
- Write `data-sources` immediately
- Then run summarization on the collected results

The current code already collects `sources` and deduplicates by URL. The only change is to move the `writeMessagePart` call for sources up — before the `summarizeSearchResults` calls, not after.

### 2. Create a unified search interface

**New file:** `src/web-search.ts`

Create a provider-agnostic search function that both Tavily and Serper can back:

```typescript
export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  scrapedContent: string; // rawContent from Tavily, or empty string for Serper
  date: string;
};

export type WebSearchFn = (query: string, num: number) => Promise<WebSearchResult[]>;
```

- **Tavily adapter:** maps `result.content` to `snippet`, `result.rawContent` to `scrapedContent`
- **Serper adapter:** maps `result.snippet` to `snippet`, sets `scrapedContent` to `""` (will be scraped later or summarized as "No content")

### 3. Add a `SEARCH_PROVIDER` env variable

**File:** `src/env.js`

```
SEARCH_PROVIDER: z.enum(["tavily", "serper"]).default("tavily")
```

Make the Tavily key optional when Serper is selected, and vice versa:

```
TAVILY_API_KEY: z.string().optional()   // required only when SEARCH_PROVIDER=tavily
SERPER_API_KEY: z.string().optional()   // required only when SEARCH_PROVIDER=serper
```

Add a `.refine()` to validate that the key matching the selected provider is present.

### 4. Wire the provider into `run-agent-loop.ts`

**File:** `run-agent-loop.ts`

Replace the direct `searchTavily` import with the unified search function:

```typescript
import { getSearchFn } from "~/web-search";

// inside runAgentLoop:
const search = getSearchFn(); // reads SEARCH_PROVIDER from env
```

The rest of the loop stays the same — it already handles `scrapedContent` being empty (falls back to "No content returned from search.").

### 5. Reorder the loop for early source delivery

**File:** `run-agent-loop.ts`

Restructure the inner loop to separate search from summarization:

```typescript
// Phase 1: Search all queries, collect results
const allResults: Array<{ query: string; results: WebSearchResult[] }> = [];

for (const query of queries) {
  if (collected >= cap || isNearDeadline()) break;
  const results = await search(query, cap - collected);
  // dedup, collect sources, update collected count
  allResults.push({ query, results: deduped });
}

// Phase 2: Send sources immediately
if (sources.length > 0) {
  opts.writeMessagePart({ type: "data-sources", data: sources });
}

// Phase 3: Summarize
for (const { query, results } of allResults) {
  await summarizeSearchResults(ctx, query, results, opts.telemetry);
}
```

This mirrors the course solution pattern: search first, report sources, then summarize.

---

## File Change Summary

| File | Change |
| --- | --- |
| `src/web-search.ts` | **New** — unified search interface + Tavily/Serper adapters |
| `src/env.js` | Add `SEARCH_PROVIDER` enum, make API keys conditionally required |
| `src/run-agent-loop.ts` | Reorder: search all → send sources → summarize. Use `getSearchFn()` |
| `src/tavily.ts` | No change (kept as-is, called by adapter) |
| `src/serper.ts` | No change (kept as-is, called by adapter) |
| `src/types.ts` | No change |
| `src/components/chat-message.tsx` | No change |
| `.env.shared` / `env.shared.example` | Add `SEARCH_PROVIDER=tavily` default |

## What not to change

- **Types / annotations** — `Source`, `OurMessage`, `data-sources` are all correct
- **Frontend components** — `Sources`, `ReasoningSteps`, `ChatMessage` already handle everything
- **`summarize-url.ts`** — works with any content, no provider awareness needed
- **`system-context.ts`** — `reportSearch` is provider-agnostic

## Testing

1. Set `SEARCH_PROVIDER=tavily` — verify sources appear in UI before summarization completes
2. Set `SEARCH_PROVIDER=serper` — verify the loop works with snippet-only results (summaries will note "No content" for pages that can't be scraped)
3. Remove `TAVILY_API_KEY`, set `SEARCH_PROVIDER=serper` — verify app starts and searches work
4. Ask a multi-faceted question — verify a single `Sources` step per loop iteration, not one per query
