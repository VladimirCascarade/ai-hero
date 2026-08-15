# Migrating `00-apps` to AI SDK v6 + OpenRouter

Single doc for the whole migration. **Code patterns**: `07-migrated-to-v5`. **Env + model**: `shared/` folder + `pnpm sync-env` (see below).

**Goals**

1. All AI-enabled apps run on **AI SDK v6** API patterns (reference: `07-migrated-to-v5` for *code shape*, not its old package betas).
2. **OpenRouter only** — drop `@ai-sdk/google` and `GOOGLE_GENERATIVE_AI_API_KEY` everywhere.
3. Multi-step **tool loops** work (deep search).

**Out of scope until asked**

- API probe scripts or bulk `pnpm install` across all apps at once
- Reading or committing `.env` / `.env.shared` files
- **Any LLM API calls** — no chat in the UI, no `pnpm evals`, no probe scripts (burns tokens)

---

## Current state

| App | `ai` | Provider | SDK migration | Notes |
| --- | --- | --- | --- | --- |
| `01-day-1-app` | — | — | N/A | No LLM yet |
| `02-day-3-app` | `6.0.0` | OpenRouter | **Done** | Tool loop + v6 UI stream |
| `03-day-4-app` | `6.0.0` | OpenRouter | **Done** | Tool loop + v6 UI stream |
| `04-day-6-app` | `6.0.0` | OpenRouter | **Done** | Tool loop + v6 UI stream |
| `05-day-8-app` | `6.0.0` | OpenRouter | **Done** | Agent loop; annotations → `data-new-action` |
| `05.5-day-8-app-with-resumable-streams` | `6.0.0` | OpenRouter | **Done** | Resumable streams via `consumeSseStream` + `resume: true` |
| `06-final-app` | `6.0.0` | OpenRouter | **Done** | Full agent loop + guardrails |
| `07-migrated-to-v5` | `6.0.0` | OpenRouter | **Done** | Reference implementation |

---

## Target stack (every AI app)

### `package.json` dependencies

```json
{
  "ai": "6.0.0",
  "@ai-sdk/react": "3.0.0",
  "@openrouter/ai-sdk-provider": "2.9.1"
}
```

**Remove:** `@ai-sdk/google`

Pin exactly — `@openrouter/ai-sdk-provider@latest` targets `ai@7`; use **`2.9.1`** for `ai@6`.

Run `pnpm install` **one app at a time** after editing that app's `package.json`.

### Environment (one file for all apps)

**Do not edit each app's `.env` by hand.** Use the `shared/` workflow:

| File | Committed? | Purpose |
| --- | --- | --- |
| `shared/env.shared.example` | Yes | Template — copy once to `shared/.env.shared` |
| `shared/.env.shared` | No (gitignored) | **Your secrets + model selection** |
| `shared/model.ts` | Yes | OpenRouter model — synced to each AI app |
| `shared/env.js` | Yes | Env schema — synced to each AI app |
| `shared/sync-env.mjs` | Yes | Sync script |

**Setup (once):**

```bash
cd courses/01-deepsearch-in-typescript/00-apps
cp shared/env.shared.example shared/.env.shared
# Edit shared/.env.shared — OPENROUTER_API_KEY, OPENROUTER_MODEL, Discord, etc.
pnpm sync-env
```

**Change model for all apps:** edit `OPENROUTER_MODEL` in `shared/.env.shared`, run `pnpm sync-env` again.

Default model: **`google/gemma-4-31b-it:free`**

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=google/gemma-4-31b-it:free
```

**Remove from `shared/.env.shared` when migrating:** `GOOGLE_GENERATIVE_AI_API_KEY`

Pick models at https://openrouter.ai/models — deep-search apps need **tool calling**.

**Links:** keys https://openrouter.ai/keys · AI SDK https://ai-sdk.dev/providers/community-providers/openrouter · guide https://openrouter.ai/docs/guides/community/vercel-ai-sdk

Per-app `.env.example` files stay as documentation; `pnpm sync-env` is the source of truth for local dev.

### Global `model.ts` and `env.js`

**Do not edit per-app.** Live in `shared/` — synced by `pnpm sync-env`:

- `shared/model.ts` → `{app}/src/model.ts` (apps 02–07)
- `shared/env.js` → `{app}/src/env.js` (apps 02–07)
- `shared/.env.shared` → `{app}/.env` (all apps)

Model ID comes from `OPENROUTER_MODEL` in `shared/.env.shared`. `model.ts` uses `process.env` so one file works in every app.

**`01-day-1-app`** keeps its own minimal `env.js` (no LLM); still gets `.env` from sync.

Edit files in `shared/`, then `pnpm sync-env`.

---

## v4 → v6 code changes (copy from `07` where possible)

Use `07-migrated-to-v5/src` as the pattern reference after packages are bumped.

### Types

- `Message` → `UIMessage` / `OurMessage` (see `07/src/types.ts`)

### Chat API route

| v4 | v6 |
| --- | --- |
| `createDataStreamResponse` | `createUIMessageStream` + `createUIMessageStreamResponse` |
| `appendResponseMessages` | `[...messages, ...response.messages]` in `onFinish` |
| `mergeIntoDataStream` | `writer.merge(result.toUIMessageStream())` |
| `writeData` / `writeMessageAnnotation` | `writer.write({ type: "data-...", data })` |

### Client (`chat.tsx`)

| v4 | v6 |
| --- | --- |
| `useChat({ body, initialMessages })` | `useChat({ transport: new DefaultChatTransport({ body }), messages })` |
| hook `input` / `handleSubmit` | local state + `sendMessage({ text })` |
| `isLoading` | `status === "streaming"` |
| `data` + `useEffect` | `onData` for `data-new-chat-created` |

`import { DefaultChatTransport } from "ai"`.

### Messages & UI

- `message.content` → `message.parts` + `messageToString()` (`07/src/utils.ts`)
- Tool UI: `isToolUIPart` — not v4 `tool-invocation`
- DB / `queries.ts` / `page.tsx`: store and load `parts` only

### Tools & agent loop

- `maxSteps` → `stopWhen: stepCountIs(n)`
- `parameters:` → `tool({ inputSchema, execute })`
- Before `streamText`: `convertToModelMessages(messages)`

### Annotations → data parts (`05`, `06`, `07`)

- `OurMessageAnnotation` → data parts: `data-new-action`, `data-sources`, `data-usage`
- Drop `annotations` column where it exists

### Evals

- `UIMessage` with `parts: [{ type: "text", text: input }]`

---

## Later: OpenRouter model reasoning (optional)

**Not part of this migration.** Leave reasoning off for now.

OpenRouter supports models with internal chain-of-thought (e.g. Gemma 4 “thinking mode”). That is separate from the app’s own action “reasoning” string in `get-next-action.ts` (shown in the UI via `data-new-action` parts) — that stays as-is.

When you want model-level reasoning later:

- Docs: https://openrouter.ai/docs/use-cases/reasoning-tokens
- Our stack uses `@openrouter/ai-sdk-provider` + `ai`, not `@openrouter/sdk`
- Enable per call via `providerOptions.openrouter.reasoning` on `streamText` / `generateText`:

```ts
providerOptions: {
  openrouter: {
    reasoning: { effort: "medium" }, // or max_tokens: N — not both
  },
},
```

**Caveats for later live-testing:** multi-turn tool loops may require preserving `reasoning_details` in message history (similar to Gemini thought signatures). Verify on OpenRouter model page first; no API calls needed for that.

**Default for migration:** no `reasoning` in provider options.

---

## Per-app work list

### `02-day-3-app` (finish)

Already on `ai@6` with v6 streaming/tools. Remaining:

- [ ] `package.json`: add `@openrouter/ai-sdk-provider@2.9.1`, remove `@ai-sdk/google`
- [ ] `env.js`: OpenRouter vars; remove Google (see below)
- [ ] `model.ts`: OpenRouter snippet above (3 exports)
- [ ] `pnpm sync-env` from `00-apps/` (if `.env.shared` changed)
- [ ] `pnpm install` + verification (below — no API calls)

### `03-day-4-app`

- [ ] Package pin + OpenRouter env/model
- [ ] Full v4→v6 pass: `api/chat/route.ts`, `chat.tsx`, `chat-message.tsx`, tools, `queries.ts`, `page.tsx`

### `04-day-6-app`

- [ ] Same as `03` + `deep-search.ts`

### `05-day-8-app`

- [ ] Same as `04` + `types.ts`, annotation writers → data parts

### `06-final-app`

- [ ] Same as `05` + `run-agent-loop.ts`, guardrails, sources/usage parts

### `07-migrated-to-v5` (reference + cleanup)

Already has v6 UI stream shape. Remaining:

- [ ] OpenRouter env/model (same as above)
- [ ] Fix typecheck: evals still use `content`, `StreamTextResult` mismatches in `answer-question.ts`, `deep-search.ts`, `run-agent-loop.ts`
- [ ] Remove `@ai-sdk/google`

### `01-day-1-app`

Skip until LLM is added; then follow this doc from the package pin step.

---

## Execution order

1. **`07`** — fix types + OpenRouter (keeps reference app honest)
2. **`02`** — finish (closest to done)
3. **`06` → `05` → `04` → `03`** — hardest/features-first down to simplest

One app per pass: edit files → `pnpm install` → [verification](#verification-no-api-calls) → next app.

---

## Verification (no API calls)

**Smoke test** (industry term) = “run the app and try one real chat turn.” We **do not** do that here — it hits OpenRouter and costs tokens.

After each app migration, verify **statically only**:

| Step | Command / action | Burns tokens? |
| --- | --- | --- |
| Types | `pnpm typecheck` | No |
| Lint | `pnpm lint` (optional) | No |
| Build | `pnpm build` (optional, slower) | No |
| Stragglers | Grep list below — zero hits | No |
| Google removed | No `@ai-sdk/google`, `google(`, `GOOGLE_GENERATIVE_AI_API_KEY` | No |

**Do not run** unless you explicitly ask: `pnpm dev` + send chat, `pnpm evals`, curl to `/api/chat`, or any script that calls the model.

Live end-to-end testing is **your call** when you want to spend tokens.

---

## Find stragglers (grep each app's `src/`)

```text
@ai-sdk/google
google(
gemini-
GOOGLE_GENERATIVE_AI_API_KEY
createDataStreamResponse
appendResponseMessages
mergeIntoDataStream
writeMessageAnnotation
initialMessages
handleInputChange
isLoading
message.content
OurMessageAnnotation
tool-invocation
maxSteps
parameters:
```

Zero hits (except comments) = that concern is done for that app.

---

## Approval checklist

- [x] OpenRouter-only provider — agreed
- [x] Package pin (`ai@6`, `@openrouter/ai-sdk-provider@2.9.1`) — agreed
- [x] Execution order (`07` → `02` → `06`…`03`) — agreed
- [x] Default model `google/gemma-4-31b-it:free` — agreed
- [x] Shared env via `.env.shared` + `pnpm sync-env` — agreed

Migration work is **in-app code edits** + **`pnpm sync-env`** for env — no per-app `.env` hand-editing.
