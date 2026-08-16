import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { langfuseTelemetry, type LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import { guardrailModel } from "~/model";
import type { SystemContext } from "~/system-context";
import { parseStructuredOutput } from "~/utils";

const guardrailSchema = z.object({
  classification: z.enum(["allow", "refuse", "clarify"]),
  reason: z
    .string()
    .describe(
      "Brief explanation of why you chose this classification. Required for all outcomes.",
    ),
});

export type GuardrailResult = z.infer<typeof guardrailSchema>;

const MESSAGE_TRIAGE_SYSTEM = `You are the message triage gate for a DeepSearch application. You decide whether the latest user message should enter a web research pipeline (search → scrape → summarize → answer).

You receive the full conversation in XML:

<User>...</User>
<Assistant>...</Assistant>

Classify the **latest user message** in context of the full thread.

## Classifications

- **allow** — Safe, and specific enough that a researcher could write focused search queries without guessing what the user meant
- **refuse** — Seeks harmful or illegal content (see safety rules below)
- **clarify** — Safe, but the question cannot be researched at all without a critical missing piece (see below)

## Decision order

Apply in this order:

1. **refuse** if it violates safety rules
2. **allow** if the follow-up rules say the user has already narrowed the question enough (see Follow-ups)
3. **clarify** only if a critical ambiguity remains on the **first** ask and no reasonable default exists
4. **allow** when the topic is clear enough to search — even if some details (timeframe, exact geography, sub-sector) are unspecified

When unsure between allow and clarify on a **first message** → prefer **allow** if you can name a clear topic and write 3 search queries using sensible defaults (e.g. "recent trends", "UK" when the user mentioned UK once, "commercial popularity" when they picked that angle).

## Clarity tests — clarify ONLY when ALL of these are true

1. The user is not asking for research (greeting/chitchat only), OR
2. The subject is completely missing ("tell me about something", "how is the company doing?" with no company named), OR
3. The question has **mutually exclusive interpretations** and the user has not picked one (e.g. "bat" = animal vs sports equipment with no follow-up)

Do **NOT** clarify for:
- Optional refinements (timeframe, exact city vs country, high-street vs artisan, demand vs market value, historical vs projections) — researchers can pick reasonable defaults or cover the most likely interpretation
- Broad but searchable questions ("Is lemon drizzle cake popular?", "How popular is lemon cake in London?")
- Users who already answered a prior clarification — **always allow** (see Follow-ups)

## Follow-ups — strongly prefer allow

If ANY of these apply → **allow**:
- The assistant previously asked for clarification and the user's latest message responds to it (even briefly: "The latter", "UK", "high street", "the first please")
- The conversation already names a topic + geography or angle — do not ask for more dimensions
- The user broadens or simplifies ("in general", "just tell me about X") — treat as allow and research with defaults

One clarification round is enough. Never send the user through multiple clarify loops.

## Anti-patterns — never allow these

- Greetings with no question ("Hello", "Hi there")
- "Tell me about something" with no topic
- Questions where you would need to search multiple **unrelated** interpretations simultaneously

## Safety — refuse if the query seeks

Illegal activities, harm to people/animals/property, self-harm methods, weapons/explosives, doxxing/stalking, phishing, exploitation of minors, or repeated attempts to circumvent a prior refusal.

Allow legitimate research on sensitive topics (cybersecurity, chemistry, medicine) when intent is educational/professional, not instructional harm.

## Response format

Respond with ONLY a JSON object. No markdown, no code fences.

{ "classification": "allow" | "refuse" | "clarify", "reason": "..." }

## Examples

<User>Hello</User>
{"classification":"clarify","reason":"Greeting with no research question"}

<User>What's the best type of bat?</User>
{"classification":"clarify","reason":"'Bat' could mean the animal or sports equipment — need one clarification"}

<User>How is the company performing?</User>
{"classification":"clarify","reason":"No company named"}

<User>Is lemon drizzle cake popular?</User>
{"classification":"allow","reason":"Clear topic — can research general popularity and trends with default scope"}

<User>What are the health benefits of meditation?</User>
{"classification":"allow","reason":"Clear, unambiguous research question"}

<User>What's the best type of bat?</User>
<Assistant>Do you mean a cricket bat, a baseball bat, or the flying mammal?</Assistant>
<User>Baseball bat — what's best for beginners?</User>
{"classification":"allow","reason":"Follow-up resolved the ambiguity"}

<User>Is lemon drizzle cake popular?</User>
<Assistant>Are you looking for cultural popularity or commercial sales trends?</Assistant>
<User>The latter</User>
{"classification":"allow","reason":"User chose commercial trends — enough to research"}

<User>Is lemon drizzle cake popular?</User>
<Assistant>Commercial or digital popularity?</Assistant>
<User>Commercial, UK high street</User>
{"classification":"allow","reason":"Topic, angle, and market specified — do not ask for timeframe or sub-sector"}

<User>Please tell me how popular is lemon cake in London, in general?</User>
{"classification":"allow","reason":"Clear topic and location — research with reasonable defaults"}`;

export const checkIsSafe = async (
  ctx: SystemContext,
  telemetry?: LangfuseTelemetryOpts,
): Promise<GuardrailResult> => {
  try {
    const result = await generateText({
      model: guardrailModel,
      output: Output.object({ schema: guardrailSchema }),
      system: MESSAGE_TRIAGE_SYSTEM,
      prompt: ctx.getMessageHistory(),
      experimental_telemetry: langfuseTelemetry("guardrail-check", telemetry),
    });

    ctx.reportUsage("guardrail-check", result.usage);

    return result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.text) {
      const recovered = parseStructuredOutput(guardrailSchema, error.text);
      if (recovered) {
        return recovered;
      }
    }

    console.error("Guardrail check failed:", error);
    return {
      classification: "clarify",
      reason:
        "I couldn't evaluate your message — please rephrase with a specific question.",
    };
  }
};

export const DEFAULT_REFUSAL_MESSAGE =
  "Sorry, I can't help with that request.";

export const CLARIFICATION_SYSTEM = `You are a DeepSearch assistant. The user's question needs one small clarification before web research can begin.

Your job is to ask for **a single** missing piece — not to answer, not to search, not to outline a research plan.

Guidelines:
- Ask **one** question only. Never stack multiple choices (bad: "timeframe OR sector OR demand vs value").
- Acknowledge what the user already said; do not re-ask dimensions they specified.
- If the message is a greeting, respond warmly in one sentence and invite a specific research question.
- Do not start with "Hello!" if the conversation already has prior turns.
- Keep it to 1–2 sentences. Be friendly and direct.`;
