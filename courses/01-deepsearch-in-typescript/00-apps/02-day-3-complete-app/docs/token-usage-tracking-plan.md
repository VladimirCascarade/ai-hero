# Token Usage Tracking & Session Budget Plan

## Goal

Track cumulative token usage across all LLM calls in a session, display it inline with the chat input, and enforce an optional session-wide token budget that stops the agent loop and disables further input when breached.

---

## Architecture: Hoisted `SystemContext`

`SystemContext` is the single token ledger for the entire request. The API route creates it once and passes it into both the agent loop and chat title generation. Every LLM call — whether inside the research loop, a guardrail check, or title generation — reports usage to the same instance. No manual token math in `route.ts`.

```
route.ts (creates SystemContext)
    ├── generateChatTitle(messages, telemetry, ctx) → ctx.reportUsage(...)
    └── runAgentLoop(ctx, opts) → all inner calls use ctx.reportUsage(...)
```

This means chat title tokens are tracked identically to every other call. Budget checks reflect the full cost of handling a user message. Adding future LLM work (reranking, eval hooks, etc.) only requires calling `ctx.reportUsage(...)` from the new call site.

---

## Shared Helpers: `src/token-usage.ts`

A small stateless module removes repeated budget and payload logic from `system-context.ts`, `run-agent-loop.ts`, and `route.ts`:

```ts
isSessionBudgetExceeded(totalTokens: number): boolean
toUsageDataPart(totalTokens: number): { totalTokens: number; budgetExceeded?: true }
```

**Consumers:**
- `SystemContext.getStopReason()` calls `isSessionBudgetExceeded(this.getTotalTokens())`
- `run-agent-loop.ts` `emitUsage()` calls `toUsageDataPart(ctx.getTotalTokens())`
- `route.ts` final usage emission calls `toUsageDataPart(ctx.getTotalTokens())`

**What stays local:**
- `emitUsage()` write side-effect stays in `run-agent-loop.ts` (needs `writeMessagePart` + stable `usageDataPartId`)
- `latestUsage` extraction stays in `chat.tsx` (frontend read path, different concern)
- Per-call descriptor strings stay at call sites for observability

---

## Changes Required

### 1. `SESSION_TOKEN_BUDGET` env var

**Files:** `src/env.js`, `.env`

```ts
SESSION_TOKEN_BUDGET: z.coerce.number().default(0), // 0 = unlimited
```

Default in `.env`: `SESSION_TOKEN_BUDGET=200000`

### 2. `SystemContext` — token tracking + budget

**File:** `src/system-context.ts`

- `TokenUsage` type with `descriptor`, `promptTokens`, `completionTokens`, `totalTokens`
- `private usages: TokenUsage[]`
- `reportUsage(descriptor, usage: LanguageModelUsage)` — normalizes `inputTokens`/`outputTokens`/`totalTokens`
- `getUsages()`, `getTotalTokens()`
- `getStopReason()` returns `"steps" | "budget" | null`, uses `isSessionBudgetExceeded()` from helpers
- `shouldStop()` delegates to `getStopReason() !== null`

### 3. Shared helpers

**File (new):** `src/token-usage.ts`

- `isSessionBudgetExceeded(totalTokens)` — reads `env.SESSION_TOKEN_BUDGET`, returns boolean
- `toUsageDataPart(totalTokens)` — builds `{ totalTokens, budgetExceeded? }` payload

### 4. Report usage from every LLM call site

**`generateText` calls** (usage available immediately):

| File | Descriptor |
|---|---|
| `get-next-action.ts` | `"get-next-action"` |
| `query-rewriter.ts` | `"query-rewriter"` |
| `guardrails.ts` | `"guardrail-check"` |
| `generate-chat-title.ts` | `"generate-chat-title"` — receives `ctx`, calls `ctx.reportUsage(...)` directly |

**`summarizeURL`** returns `{ text, usage }`. Caller in `run-agent-loop.ts` reports via `ctx.reportUsage("summarize-url", usage)`.

**`streamText` calls** (usage is a promise):

| File | Descriptor | Pattern |
|---|---|---|
| `answer-question.ts` | `"answer-question"` / `"answer-question-final"` | `result.usage.then(u => ctx.reportUsage(...))` |
| `run-agent-loop.ts` | `"guardrail-refusal"` / `"guardrail-clarification"` | Same `.usage.then(...)` pattern |

### 5. Hoist `SystemContext` to `route.ts`

**File:** `src/app/api/chat/route.ts`

- Create `const ctx = new SystemContext(messages)` in the route
- Pass `ctx` into `streamFromDeepSearch` (and through to `runAgentLoop`)
- Pass `ctx` into `generateChatTitle` — title gen calls `ctx.reportUsage(...)` on completion
- After `consumeStream()`, emit a final `data-usage` part via `toUsageDataPart(ctx.getTotalTokens())`
- No manual token math — route only reads `ctx.getTotalTokens()` through the helper

### 6. Update `runAgentLoop` signature

**Files:** `src/run-agent-loop.ts`, `src/deep-search.ts`

- `runAgentLoop` receives `ctx: SystemContext` instead of `messages: UIMessage[]`
- No longer creates `SystemContext` internally
- `emitUsage()` uses `toUsageDataPart()` from helpers
- `AgentLoopResult` simplified: no `getTotalTokens` / `getStopReason` — callers use `ctx` directly

### 7. `usage` data part type

**File:** `src/types.ts`

```ts
usage: { totalTokens: number; budgetExceeded?: boolean }
```

### 8. Frontend: token counter inline with input

**File:** `src/app/chat.tsx`

- `latestUsage` — `flatMap` + `findLast` to get last `data-usage` part from assistant messages
- `Coins` icon from lucide-react, positioned left of the input
- Red text + disabled Send button when `budgetExceeded` is true

---

## Files Changed (Summary)

| File | Change |
|---|---|
| `src/env.js` | Add `SESSION_TOKEN_BUDGET` |
| `.env` | Add default value |
| `src/token-usage.ts` | New — `isSessionBudgetExceeded()`, `toUsageDataPart()` |
| `src/system-context.ts` | `TokenUsage`, `reportUsage()`, `getTotalTokens()`, `getStopReason()`, `shouldStop()` |
| `src/types.ts` | Add `usage` data part to `OurMessage` |
| `src/generate-chat-title.ts` | Accept `ctx`, call `ctx.reportUsage(...)` |
| `src/answer-question.ts` | Attach `.usage.then(...)` side-effect |
| `src/get-next-action.ts` | Add `ctx.reportUsage(...)` |
| `src/query-rewriter.ts` | Add `ctx.reportUsage(...)` |
| `src/guardrails.ts` | Add `ctx.reportUsage(...)` |
| `src/summarize-url.ts` | Return `{ text, usage }` |
| `src/run-agent-loop.ts` | Receive `ctx` param, use `toUsageDataPart()`, emit `data-usage` parts |
| `src/deep-search.ts` | Pass `ctx` through to `runAgentLoop` |
| `src/app/api/chat/route.ts` | Create `SystemContext`, pass to loop + title, final usage emission via helpers |
| `src/app/chat.tsx` | Token counter with `Coins` icon, budget-exceeded disable |

---

## Out of Scope

- Persisting per-session token totals to the database
- Per-call breakdown in the UI (only total displayed)
- Per-user or per-org budget enforcement
- Cost calculation in dollars — raw token counts only

---

## Testing

1. Set `SESSION_TOKEN_BUDGET=50000` in `.env`
2. Ask a question that triggers multiple research steps
3. Verify the token counter appears left of the input with a currency icon
4. Verify the counter updates as the agent progresses through steps
5. If the budget is exceeded, verify the counter turns red and Send is disabled
6. Set `SESSION_TOKEN_BUDGET=0` — agent runs without budget constraint (falls back to `MAX_AGENT_STEPS`)
7. In tests, mock `SystemContext` when token math isn't the test subject; use a real instance when asserting budget/stop behavior
