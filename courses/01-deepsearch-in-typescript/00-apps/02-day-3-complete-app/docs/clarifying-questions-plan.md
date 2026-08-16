# Clarifying Questions — Implementation Plan

> **Status:** Implemented — unified message triage in `guardrails.ts` + clarify branch in `run-agent-loop.ts`

## Problem

Every user message immediately enters the search/summarize/evaluate loop, even when the question is:
- A greeting ("Hello!")
- Vague ("Tell me about something")
- Ambiguous ("What's your favourite type of bat?" — cricket, baseball, or flying mammal?)

We need a pre-loop check that asks for clarification when the query is too vague to produce useful search results.

## Course Prompt vs. Our Architecture — Gap Analysis

### 1. Two sequential LLM calls vs. one combined call

| Course | Our approach |
| --- | --- |
| Separate `checkIfQuestionNeedsClarification` function after guardrails — two blocking calls before the loop | Extend the existing guardrail call to return a third classification: `clarify` |

The course treats guardrails and clarification as separate concerns with separate LLM calls. But both:
- Run on the fast model
- Take the same input (message history)
- Block before the agent loop
- Return a classification + reason

Running them sequentially adds ~1–2s of latency on every request. Combining them into one call halves that.

**Decision:** Extend the guardrail schema from `["allow", "refuse"]` to `["allow", "refuse", "clarify"]`. One call, three outcomes. Prompt-only triage — no regex/heuristic overrides.

### 2. `generateObject` vs. `generateText` + `Output.object`

Same gap as guardrails — course uses `generateObject`, we use `generateText` + `Output.object` with JSON fence recovery. No change to our approach.

### 3. Clarification response — extra model call

The course streams the clarification response via `streamText` with a system prompt like "You are a clarification agent" and the reason as context. This is another model call.

**Decision:** Same pattern as our guardrail refusal (Option B). Use a minimal `streamText` on `guardrailModel` that asks the user to clarify, seeded with the `reason` from the classification. This keeps the response natural while staying cheap and fast.

### 4. Clarification prompt wording

The course prompt is comprehensive but there's overlap with our guardrail prompt (both analyze message history, both produce JSON, both have examples). Merging them avoids duplicate instruction sections.

**Decision:** Add clarification rules and examples directly into the existing `GUARDRAIL_SYSTEM` prompt, expanding it into a unified "message triage" prompt.

### 5. Multi-turn behavior

When the user replies to a clarification request, the next request includes the full conversation history (original vague question + assistant clarification + user's follow-up). The combined check should see the follow-up has enough context and classify as `allow`.

This works naturally — no special handling needed. The `SystemContext.isFollowUp()` method already detects multi-turn conversations, and the message history provides full context.

### 6. Edge case: greetings and chitchat

The course lists greetings as a clarification case. But "Hello!" doesn't need clarification — it needs a brief friendly response. Asking "Could you clarify what you mean by Hello?" would be awkward.

**Decision:** Treat pure greetings/chitchat as `clarify` with a reason like "This is a greeting, not a research question." The clarification `streamText` call's system prompt should handle this gracefully — it can respond conversationally when the reason indicates chitchat, and ask a clarifying question when the reason indicates ambiguity.

### 7. Telemetry

Already handled — the guardrail call is traced as `guardrail-check`. Since we're extending it rather than adding a new call, telemetry coverage is automatic.

---

## Implementation Steps

### 1. Update `src/guardrails.ts`

**Schema change:**
```typescript
const guardrailSchema = z.object({
  classification: z.enum(["allow", "refuse", "clarify"]),
  reason: z.string().optional()
    .describe("Required when 'refuse' or 'clarify'. Explain why."),
});
```

**Prompt change:** Extend `GUARDRAIL_SYSTEM` to include clarification rules after the safety rules. Add clarification examples alongside the existing safety examples.

### 2. Update `src/run-agent-loop.ts`

Add a `clarify` branch after the existing `refuse` branch:

```typescript
const guardrailResult = await checkIsSafe(ctx, opts.telemetry);

if (guardrailResult.classification === "refuse") {
  // existing refusal logic
}

if (guardrailResult.classification === "clarify") {
  return streamText({
    model: guardrailModel,
    system: "You are a helpful assistant. The user's question needs clarification before you can research it. Ask them to clarify based on the reason provided. Be friendly and specific about what information you need. If the message is a greeting or chitchat, respond conversationally and invite them to ask a research question.",
    prompt: `Message history:\n${ctx.getMessageHistory()}\n\nReason clarification is needed: ${guardrailResult.reason}`,
    experimental_telemetry: langfuseTelemetry("guardrail-clarification", opts.telemetry),
  });
}
```

### 3. No type/UI changes needed

Clarification responses are plain assistant text, same as refusals.

---

## Files to Change

| File | Change |
| --- | --- |
| `src/guardrails.ts` | Extend schema to `["allow", "refuse", "clarify"]`, expand system prompt |
| `src/run-agent-loop.ts` | Add `clarify` branch after `refuse` |

## Files NOT Changed

| File | Reason |
| --- | --- |
| `src/model.ts` | Already has `guardrailModel` |
| `src/types.ts` | No new data parts |
| `src/components/chat-message.tsx` | Clarification is normal text |
| `src/app/api/chat/route.ts` | No route-level changes |

## Test Cases

| Input | Expected classification |
| --- | --- |
| "Hello!" | `clarify` — respond conversationally, invite a question |
| "Tell me about something" | `clarify` — ask what topic they want to research |
| "What's the best type of bat?" | `clarify` — ask whether they mean cricket, baseball, or the animal |
| "What are the health benefits of meditation?" | `allow` — clear and searchable |
| "How do I hack someone's email?" | `refuse` — safety violation |
| "What happened in the 2024 US presidential election?" | `allow` — unambiguous |
| "How is the company doing?" | `clarify` — which company? |
