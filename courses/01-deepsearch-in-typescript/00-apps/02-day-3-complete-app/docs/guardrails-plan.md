# Guardrails Implementation Plan

> **Status:** Implemented — `guardrails.ts` + guardrail gate in `run-agent-loop.ts`

## Course Prompt vs. Our Architecture — Gap Analysis

The course exercise uses `generateObject` and the `@ai-sdk/google` provider. Our app has diverged in several ways. Below is every gap, with the decision for each.

### 1. `generateObject` vs. `generateText` + `Output.object`

| Course | Our app |
| --- | --- |
| `generateObject({ model, schema, ... })` | `generateText({ model, output: Output.object({ schema }), ... })` with JSON fence recovery |

**Decision:** Use `generateText` + `Output.object` for consistency with `getNextAction` and `queryRewriter`. Wrap in the same `NoObjectGeneratedError` / `parseStructuredOutput` recovery pattern we use everywhere else.

### 2. Model provider

| Course | Our app |
| --- | --- |
| `google("gemini-2.0-flash-001")` via `@ai-sdk/google` | OpenRouter via `@openrouter/ai-sdk-provider` |

**Decision:** No change needed. We already have `guardrailModel` exported from `model.ts`, pointing at `fastModel` (the fast OpenRouter model). It's cheap and fast — exactly what the course wants.

### 3. Refusal UX — `streamText` with a "refuse" prompt

The course solution (in `06-final-app`) handles refusal by returning a `streamText` result with a system prompt like "You are a content safety guardrail. Refuse to answer unsafe questions." and the reason as the prompt. This streams a polite refusal as though it were a normal assistant answer.

**Problem:** This wastes a model call just to reformat a refusal message we already have. It adds latency, cost, and a potential failure point.

**Decision:** Instead of calling the model again, write a plain text refusal directly into the stream using `writeMessagePart`. This is instant, free, and deterministic. If we want the refusal to feel more natural, we can use the `reason` from the guardrail result directly.

However, `writeMessagePart` writes data parts, not text parts. For the refusal to appear as the assistant's text response, we need to either:
- **(A)** Still use `streamText` but with a trivial prompt (matches course solution, slightly wasteful)
- **(B)** Return a minimal `streamText` call that echoes the refusal reason (almost free with a fast model)

Since `runAgentLoop` must return a `streamText` result (the route merges it into the UI message stream), we'll go with **(B)**: a minimal `streamText` that echoes the refusal. But we'll simplify the prompt to avoid the extra system prompt overhead the course solution uses.

### 4. Where the guardrail runs

| Course (06-final-app) | Our app |
| --- | --- |
| Top of `runAgentLoop`, before the `while` loop | Same — top of `runAgentLoop` |

**Decision:** Same placement. The guardrail runs once per request, before any search/summarize work. This blocks the agent loop until classification completes, but the fast model should return in <1s.

### 5. Telemetry / Langfuse tracing

The course solution doesn't trace the guardrail call. We should, since every other model call in our app is traced.

**Decision:** Pass `telemetry` to the guardrail `generateText` call with `functionId: "guardrail-check"`.

### 6. Frontend display for refused messages

The course solution streams the refusal as normal text — no special UI treatment. The refusal just appears as an assistant message.

**Decision:** Same — no special data part needed. The refusal text flows through the normal `text` part rendering in `ChatMessage`. No changes to `types.ts` or `chat-message.tsx`.

### 7. Prompt caching alignment

All our other prompts put dynamic content (message history, date) after a `---` separator at the end. The guardrail prompt from the course puts message history in the `prompt` field (not `system`), which naturally separates static system instructions from dynamic content. This already aligns with our caching strategy.

**Decision:** No change needed — the system prompt is static, the `prompt` is dynamic.

### 8. JSON fence recovery

Our free OpenRouter models sometimes wrap JSON in markdown fences. The course solution uses `generateObject` which handles this internally. With `generateText` + `Output.object`, we need our existing recovery pattern.

**Decision:** Wrap in `try/catch` with `NoObjectGeneratedError` + `parseStructuredOutput`, same as `getNextAction` and `queryRewriter`.

### 9. Error handling — guardrail failure

What happens if the guardrail model call itself fails (rate limit, timeout, network error)?

The course solution doesn't address this. If `generateObject` throws, the error propagates up, and the entire request fails with a 500.

**Decision:** Fail open — if the guardrail call throws, log the error and proceed with the agent loop. The guardrail is a safety enhancement, not a load-bearing wall. A failed guardrail check shouldn't prevent legitimate users from getting answers. The model providers we use (OpenRouter free tier) are more likely to rate-limit than our users are to be malicious.

### 10. Edge cases in the prompt

The course prompt's "Edge Cases" section is overly aggressive:

> "Legitimate research questions that could potentially be misused" → refuse
> "Educational queries that need context boundaries but lack proper safeguards" → refuse

This will false-positive on many valid DeepSearch queries (e.g. "how do SQL injection attacks work" for a security researcher). For a research-oriented app, this is counterproductive.

**Decision:** Soften the edge cases section. Allow legitimate research and educational queries. Only refuse queries with clear malicious intent or that seek step-by-step instructions for harm.

---

## Implementation Steps

### 1. Create `src/guardrails.ts`

New file with `checkIsSafe(ctx, telemetry?)`:

- Uses `generateText` + `Output.object` with the guardrail schema
- Uses `guardrailModel` from `model.ts` (already exported)
- Includes `NoObjectGeneratedError` recovery
- Returns `{ classification: "allow" | "refuse", reason?: string }`

### 2. Wire into `runAgentLoop`

At the top of `runAgentLoop`, before the `while` loop:

```typescript
const guardrailResult = await checkIsSafe(ctx, opts.telemetry);
if (guardrailResult.classification === "refuse") {
  return streamText({
    model,
    prompt: guardrailResult.reason ?? "Sorry, I can't help with that request.",
  });
}
```

This returns early — no search, no summarization, no evaluator. The `streamText` result flows through the existing `writer.merge` + `consumeStream` path in `route.ts` unchanged.

### 3. No type changes needed

The refusal is plain text streamed through the normal assistant message channel. No new data parts, no `OurMessage` changes, no frontend changes.

---

## Files to Change

| File | Change |
| --- | --- |
| `src/guardrails.ts` | **New** — `checkIsSafe` function |
| `src/run-agent-loop.ts` | Import + call `checkIsSafe` before the loop |

## Files NOT Changed

| File | Reason |
| --- | --- |
| `src/model.ts` | `guardrailModel` already exported |
| `src/types.ts` | No new data parts |
| `src/components/chat-message.tsx` | Refusal is normal text |
| `src/app/api/chat/route.ts` | No route-level changes |
