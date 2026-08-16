# Resumable Streams — Implementation Plan

Plan for adding resumable streams to `02-day-3-complete-app`, adapted to the **current architecture** (not the older course `createDataStream` pattern).

Reference implementation: `05.5-day-8-app-with-resumable-streams`  
Course write-up: `03-day-2/07-resumable-streams/problem.md` (API names differ — see below)

---

## Goal

When a user refreshes or disconnects **during an in-progress response**, they should reconnect and see:

1. Research steps already streamed (`data-research-plan`, `data-sources`, `data-new-action`)
2. The final answer text as it continues streaming

Without resumable streams, a refresh mid-run loses everything until `onFinish` saves to Postgres.

---

## Current State (`02-day-3-complete-app`)

| Area | Today |
|---|---|
| Stream API | `createUIMessageStream` + `createUIMessageStreamResponse` (AI SDK v6) |
| Client | `useChat` + `DefaultChatTransport`, no `resume` |
| API | `POST /api/chat` only — no `GET` |
| Persistence | Chat saved in `onFinish` only |
| Redis | Used for caching (Serper/Tavily/summaries) and app rate limits — **not** stream buffering |
| DB | `chats` + `messages` — **no `streams` table** |

### Agent loop data parts (must survive resume)

These are written via `writeMessagePart` during `runAgentLoop`:

| Part type | When | Transient? |
|---|---|---|
| `data-research-plan` | After `queryRewriter` | No — show in UI |
| `data-sources` | After Tavily searches | No — snippet cards |
| `data-new-action` | After `getNextAction` | No — continue/answer step |
| `data-new-chat-created` | New chat start | Yes (`transient: true`) |
| `text` (answer) | Via `writer.merge(result.toUIMessageStream())` | No |

### Long-running work before answer text

```
queryRewriter → Tavily (capped by SCRAPE_URLS_COUNT) → summarizeURL × N → getNextAction → answerQuestion (streamText)
```

Most wall-clock time is **before** answer tokens appear. Resumable streams help users who refresh during Tavily/LLM work — they reconnect to the same SSE buffer instead of seeing a blank chat.

---

## Target Architecture

```
Browser                    POST /api/chat                    Redis (resumable-stream)
   │                              │                                    │
   │── sendMessage ──────────────►│ createUIMessageStream              │
   │                              │   execute → runAgentLoop           │
   │                              │   consumeSseStream ───────────────►│ buffer SSE by streamId
   │◄── SSE chunks ───────────────│                                    │
   │                              │                                    │
   │  (refresh)                   │                                    │
   │                              │                                    │
   │── GET /api/chat?chatId ─────►│ resumeExistingStream(streamId) ◄───│
   │◄── replay + live tail ───────│                                    │
```

On completion, `onFinish` still saves full messages (including all data parts) to Postgres as today.

---

## Scope

### In scope (this app only)

- `02-day-3-complete-app/`
- New doc (this file)
- DB migration for `streams` table
- `POST` + `GET` `/api/chat`
- Client reconnect wiring

### Out of scope

- Other day apps (`03-day-4-app`, `06-final-app`, etc.)
- Changing agent logic (Tavily, query rewriter, summarization)
- Mocking Tavily for tests

---

## Implementation Steps

### 1. Dependency

```bash
pnpm add resumable-stream
```

Use `resumable-stream/ioredis` (we already have `ioredis` + `REDIS_URL`).

### 2. Database

Add `streams` table to `src/server/db/schema.ts` (copy shape from `05.5-day-8-app-with-resumable-streams`):

```ts
streams: { id, chatId, createdAt }
```

Add relation on `chats`.

Add query helpers in `src/server/db/queries.ts`:

- `appendStreamId({ chatId, streamId })` — insert on stream start
- `getStreamIds({ chatId })` → `{ streamIds, mostRecentStreamId }`

Run migration:

```bash
pnpm db:generate && pnpm db:migrate
```

### 3. Stream context singleton

Add `src/server/redis/resumable-stream-context.ts`:

- `createResumableStreamContext({ waitUntil: after, publisher, subscriber })`
- Separate Redis connections for pub/sub (same pattern as `05.5`)
- Optional: graceful fallback if Redis unavailable (log + disable resume)

### 4. `POST /api/chat` changes

Keep existing behaviour:

- Auth, rate limit, `isNewChat` / title promise, Langfuse trace, `getErrorMessage` in `onError`

Add:

1. Generate `streamId = crypto.randomUUID()` before creating the stream
2. `await appendStreamId({ chatId, streamId })`
3. Inside `execute`, after `writer.merge(...)`:

   ```ts
   await result.consumeStream();
   ```

   Required so the agent keeps running and SSE is fully buffered even if the client disconnects.

4. Replace plain `createUIMessageStreamResponse({ stream })` with:

   ```ts
   return createUIMessageStreamResponse({
     stream,
     async consumeSseStream({ stream: sseStream }) {
       await streamContext.createNewResumableStream(streamId, () => sseStream);
     },
   });
   ```

**Do not remove** `originalMessages: messages` — needed for AI SDK v6 message reconciliation.

### 5. `GET /api/chat` (new)

Add handler (adapt from `05.5`):

1. Auth + `chatId` query param
2. Verify user owns chat
3. `getStreamIds({ chatId })` → `mostRecentStreamId`
4. No stream id → `204`
5. `streamContext.resumeExistingStream(mostRecentStreamId)` → return with `UI_MESSAGE_STREAM_HEADERS`
6. No active stream in Redis → `204` (client shows DB-hydrated messages from page load)

### 6. Client (`src/app/chat.tsx`)

Adapt from `05.5-day-8-app-with-resumable-streams`:

```ts
const transport = useMemo(
  () =>
    new DefaultChatTransport({
      body: { chatId, isNewChat },
      prepareReconnectToStreamRequest: () => ({
        api: `/api/chat?chatId=${chatId}`,
      }),
    }),
  [chatId, isNewChat],
);

useChat({
  id: chatId,
  messages: initialMessages,
  resume: !!chatId,
  transport,
  // keep existing onData for new-chat redirect + error display
});
```

**Keep** `ErrorMessage` with `error.message` — unchanged.

### 7. Page / routing

Verify `src/app/page.tsx` passes stable `chatId` so `resume: !!chatId` works on reload. Current `?id=` pattern should be fine — confirm `chatId` is defined before `useChat` mounts on existing chats.

---

## Behaviour After Implementation

| Scenario | Expected |
|---|---|
| Normal completion | Same as today — full message + data parts saved in `onFinish` |
| Refresh during streaming | `GET` replays buffered SSE; UI rebuilds plan/sources/actions/answer |
| Refresh after completion | Page loads messages from DB; `GET` returns `204`; no duplicate stream |
| Refresh on new chat before redirect | Edge case — `chatId` exists client-side; should resume if stream started |
| Rate limit (429 before stream) | Unchanged — no stream created |
| Agent error mid-run | `onError` message appears in stream buffer; resumable on reconnect |
| OpenRouter/Tavily 429 | Same — error string in stream |

---

## What We Are NOT Changing

- `run-agent-loop.ts` logic (Tavily cap, summarization, data part shapes)
- `get-next-action.ts` / `query-rewriter.ts`
- Env vars (reuse existing `REDIS_URL`)
- Shared `env.js` sync to other apps
- Error message formatting (`getErrorMessage` in route)

---

## Testing Plan (manual — no Tavily calls in automated tests)

1. **Happy path** — send message, wait for full answer, refresh → see completed chat from DB
2. **Mid-research refresh** — send message, refresh while "Planning research" or "Sources" visible → steps reappear, answer continues
3. **Mid-answer refresh** — refresh during answer token stream → text continues
4. **New chat** — first message creates chat, redirect works, resume doesn't break
5. **Auth** — `GET` with wrong user → 404
6. **Completed chat** — `GET` returns 204, no errors in console

---

## Risks / Open Questions (for review)

1. **`maxDuration = 60`** — agent loop can exceed 60s with Tavily + multiple summarizations. Resumable streams don't fix Vercel timeout; server may still kill the run. Separate issue — consider raising `maxDuration` or reducing work per step.

2. **Duplicate Redis usage** — `resumable-stream` pub/sub adds 2 Redis connections per process on top of existing `ioredis` cache client. Acceptable locally; watch connection limits in prod.

3. **`isNewChat` on reconnect** — `GET` resume shouldn't pass `isNewChat`. Confirm transport only sends it on `POST`.

4. **Transient parts** — `data-new-chat-created` is transient and won't replay on resume (by design). Redirect should already have happened via URL `?id=`.

5. **Multiple tabs** — two tabs on same chat both calling `GET` resume: last writer wins; acceptable for v1.

6. **Course API drift** — course doc uses `createDataStream` / `experimental_resume` / `useAutoResume`. We use AI SDK v6 `createUIMessageStream`, `resume` on `useChat`, and `DefaultChatTransport.prepareReconnectToStreamRequest`. Do **not** copy course code verbatim.

---

## File Checklist

| File | Action |
|---|---|
| `package.json` | Add `resumable-stream` |
| `src/server/db/schema.ts` | Add `streams` table |
| `src/server/db/queries.ts` | Add `appendStreamId`, `getStreamIds` |
| `drizzle/*` | New migration |
| `src/server/redis/resumable-stream-context.ts` | New — stream context singleton |
| `src/app/api/chat/route.ts` | `consumeStream`, `consumeSseStream`, `GET` handler |
| `src/app/chat.tsx` | `resume`, transport reconnect |
| `docs/resumable-streams-plan.md` | This document |

---

## Estimated Diff Size

~200–300 lines across 6–7 files. No agent-loop changes if plan is approved as written.
