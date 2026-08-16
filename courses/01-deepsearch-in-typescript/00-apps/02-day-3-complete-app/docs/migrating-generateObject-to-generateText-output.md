# Migrating `generateObject` to `generateText` with `output`

## Why

`generateObject` is deprecated in AI SDK v6. The replacement is `generateText` with an `output` option.

This matters for us because of how these two approaches work under the hood with weaker models like Gemma.

## How `generateObject` works

`generateObject` forces the model to return JSON by setting `responseFormat: { type: "json" }` at the provider level. The model **must** output raw JSON — no markdown, no explanation, just a JSON blob.

The problem: not all models respect this constraint. Gemma ignores it and returns conversational text like:

```
answer

Hello! I'm here and working perfectly. How can I help you today?
```

That's not JSON, so parsing fails and the SDK throws `NoObjectGeneratedError`.

Our previous workaround was `experimental_repairText`, which tried to extract `{...}` from the response. That only helps when JSON is embedded in the text. If there's no JSON at all (like above), repair can't help.

## How `generateText` with `output` works

```ts
import { generateText, Output } from "ai";

const result = await generateText({
  model,
  output: Output.object({ schema: actionSchema }),
  system: "...",
  prompt: "...",
});

// result.output is typed to the schema
// result.text is the raw model response
```

### Important correction

`Output.object()` is **not** a magic fix for weak models. Under the hood it still:

1. Sets `responseFormat: { type: "json" }` (same JSON mode as `generateObject`)
2. Parses the response with `safeParseJSON`
3. Validates against the Zod schema
4. Throws `NoObjectGeneratedError` if parsing or validation fails

So the migration is the **correct v6 API change**, but it does **not** solve the Gemma problem by itself. We still see the same runtime error:

```
NoObjectGeneratedError: No object generated: could not parse the response.
text: "answer\n\nHello! I'm here and working perfectly. How can I help you today?"
cause: SyntaxError: Unexpected token 'a', "answer\n\nHe"... is not valid JSON
```

The frontend currently shows a generic message via `onError` in `route.ts`:

```
Oops, an error occurred!
```

That tells the user nothing useful about what happened or what to do.

## What changes in our code

### Before (`get-next-action.ts`)

```ts
import { generateObject } from "ai";

const result = await generateObject({
  model,
  schema: actionSchema,
  system: "...",
  prompt: "...",
  experimental_repairText: async ({ text }) => {
    const match = text.match(/\{[\s\S]*\}/);
    return match?.[0] ?? null;
  },
});

return result.object;
```

### After (current)

```ts
import { generateText, Output } from "ai";

const result = await generateText({
  model,
  output: Output.object({ schema: actionSchema }),
  system: "...",
  prompt: "...",
});

return result.output;
```

Changes:

- `generateObject` → `generateText`
- `schema: actionSchema` → `output: Output.object({ schema: actionSchema })`
- `result.object` → `result.output`
- `experimental_repairText` was removed — but `Output.object()` does not replace it

## What stays the same

- The `actionSchema` (zod schema) doesn't change
- The system prompt doesn't change
- The user prompt doesn't change
- The return type is the same shape
- `run-agent-loop.ts`, `deep-search.ts`, `answer-question.ts`, and the chat route are untouched

## The tradeoff

`generateText` + `Output.object` is the right long-term API (combines structured output with tools in one call). But for action selection with Gemma, it is **not** more tolerant than `generateObject`. The model might waste tokens on conversational text that then gets thrown away when parsing fails.

## Other places using `generateObject`

`factuality-scorer.ts` and `answer-relevancy-scorer.ts` were also migrated to `generateText` + `Output.object()`. Same parsing constraints apply there, but eval failures are less user-visible than chat failures.

---

## Minimal approaches to the Gemma failure

These are ordered from smallest change to largest. Each includes what the user should see in the frontend.

### Approach 1: Better error message in the API route (smallest, no logic change)

**What:** Detect `NoObjectGeneratedError` in `route.ts` `onError` and return a specific message instead of `"Oops, an error occurred!"`.

**Where:** `src/app/api/chat/route.ts`

```ts
import { NoObjectGeneratedError } from "ai";

onError: (e) => {
  console.error(e);

  if (NoObjectGeneratedError.isInstance(e)) {
    return "The model returned an invalid response. Try sending your message again, or switch to a model that supports structured output in your .env file (OPENROUTER_MODEL_HIGH).";
  }

  return "Oops, an error occurred!";
},
```

**What the user sees:**

> The model returned an invalid response. Try sending your message again, or switch to a model that supports structured output in your .env file (OPENROUTER_MODEL_HIGH).

**What the user can do:**

1. **Retry** — click Send again with the same message (model output can vary)
2. **Rephrase** — ask a clearer question instead of a greeting like "hello"
3. **Switch model** — change `OPENROUTER_MODEL_HIGH` in `.env.shared` to a model that reliably returns JSON (e.g. a paid model)

**Pros:** ~5 lines, no agent logic changes, user gets actionable guidance  
**Cons:** Does not fix the failure — just explains it

---

### Approach 2: Minimal fallback when the model returns plain text (recommended for Gemma)

**What:** Wrap `getNextAction` in a try/catch. If `NoObjectGeneratedError` is thrown and the raw text starts with a known action keyword, map it to an action.

**Where:** `src/get-next-action.ts`

```ts
import { generateText, NoObjectGeneratedError, Output } from "ai";

export const getNextAction = async (context: SystemContext) => {
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: actionSchema }),
      // ... prompts unchanged
    });

    return result.output;
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.text) {
      throw error;
    }

    const firstLine = error.text.trim().split("\n")[0]?.toLowerCase();

    if (firstLine === "answer") return { type: "answer" as const };
    if (firstLine === "search") throw error; // need a query — can't guess
    if (firstLine === "scrape") throw error; // need URLs — can't guess

    throw error;
  }
};
```

This handles the exact failure from the terminal: Gemma returned `answer\n\nHello!...` — we can still proceed with `{ type: "answer" }` and let `answerQuestion` generate the real response.

**What the user sees:** Nothing — the request succeeds. The agent loop continues to `answerQuestion`.

**What the user can do:** Nothing required. They get an answer as normal.

**Pros:** Tiny, targeted fix for the most common Gemma failure (answering conversationally instead of returning JSON)  
**Cons:** Only helps when the first line is a recognizable action keyword. Search/scrape actions without JSON still fail.

---

### Approach 3: Combine Approach 1 + 2 (best minimal UX)

**What:** Use the fallback in `getNextAction` for recoverable cases (plain-text `answer`), and the friendly error message in `route.ts` for everything else.

**What the user sees:**

- **Recoverable** (plain-text `answer`): normal streamed answer, no error
- **Unrecoverable** (plain-text `search` with no query, or gibberish):

> The model returned an invalid response. Try sending your message again, or switch to a model that supports structured output in your .env file (OPENROUTER_MODEL_HIGH).

**What the user can do:**

1. Retry the message
2. Ask a more specific question (e.g. "What is the capital of France?" instead of "hello")
3. Switch `OPENROUTER_MODEL_HIGH` to a stronger model

**Pros:** Covers both the happy path and the failure path with minimal code  
**Cons:** Still can't recover search/scrape actions from plain text

---

### Approach 4: Use a stronger model only for action selection

**What:** Keep Gemma for `answerQuestion` (streaming, user-visible), but use a more capable model in `getNextAction` only.

**Where:** `src/model.ts`

```ts
export const model = openrouter.chat(
  process.env.OPENROUTER_MODEL_HIGH ?? "google/gemma-4-31b-it:free",
);

export const actionModel = openrouter.chat(
  process.env.OPENROUTER_ACTION_MODEL ?? "google/gemini-2.0-flash-001",
);
```

Then import `actionModel` in `get-next-action.ts`.

**What the user sees:** Normal behaviour — no errors for structured output.

**What the user can do:** Nothing, unless they want to override `OPENROUTER_ACTION_MODEL` in `.env`.

**Pros:** Most reliable fix for structured output  
**Cons:** Costs money (or uses a different free tier). Two models to configure.

---

### Approach 5: Prompt hardening (cheapest, least reliable)

**What:** Add an explicit JSON-only instruction and example to the prompt in `getNextAction`.

```ts
prompt: `...
Respond with ONLY a JSON object. No other text. Example:
{"type": "answer"}
`,
```

**What the user sees:** Either works (no error) or the same generic/unhelpful error.

**What the user can do:** Retry or switch model.

**Pros:** Zero new code paths  
**Cons:** Gemma often ignores this. Not a real fix on its own — combine with Approach 1 or 2.

---

## Recommendation

For keeping Gemma as the default test model:

| Priority | Approach | Effort |
|---|---|---|
| 1 | Approach 3 (fallback + friendly error) | ~15 lines |
| 2 | Approach 4 (stronger action model) | env + 2 lines, if budget allows |
| 3 | Approach 5 (prompt hardening) | free, use as supplement |

Approach 3 gives the best balance: the agent keeps working for the common "answer" case, and the user gets clear guidance when it can't recover.

## Frontend error flow (current)

```
getNextAction throws NoObjectGeneratedError
  → runAgentLoop throws
    → streamFromDeepSearch throws
      → route.ts createUIMessageStream onError
        → returns "Oops, an error occurred!"
          → useChat displays error to user
```

The error message returned from `onError` is what the user sees in the chat UI. Improving that string is the only frontend change needed — no React component changes required unless you want custom error styling.
