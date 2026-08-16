import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { langfuseTelemetry, type LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import { SystemContext } from "~/system-context";

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Continuing research', 'Providing answer'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["continue", "answer"]).describe(
    `The type of action to take.
      - 'continue': Continue searching for more information.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  feedback: z
    .string()
    .optional()
    .describe(
      "Required when type is 'continue'. Detailed feedback about what factual information is still missing from the search history.",
    ),
});

export type Action = z.infer<typeof actionSchema>;

export const getNextAction = async (
  context: SystemContext,
  telemetry?: LangfuseTelemetryOpts,
) => {
  const result = await generateText({
    model,
    output: Output.object({ schema: actionSchema }),
    system: `You are a research evaluator. Decide whether the search history contains enough factual information to answer the user's question, or whether another search iteration is needed.

Your job is NOT to write the answer. A separate answer step handles synthesis, formatting, step-by-step guides, and citations.

Choose 'answer' when:
- The search summaries contain the core facts needed to address the question
- The remaining work is synthesis, explanation, or formatting — not more searching
- You have relevant sources even if every edge case is not covered

Choose 'continue' ONLY when:
- Specific factual information is clearly missing from the search history
- The summaries do not address a central part of the question
- You can name concrete facts or sources that are still needed

Do NOT choose 'continue' because:
- You want to "synthesize" or "compile" information — that happens in the answer step
- You want a "step-by-step guide" and the raw material is already in the summaries
- You want more sources on the same topic when existing summaries already cover it
- The answer might be incomplete on minor details — prefer 'answer' and let the answer step note uncertainty

When providing feedback (required when type is 'continue'):
- Name the specific missing facts, not vague goals like "synthesize" or "create a guide"
- Explain why the current summaries cannot support even a partial answer

The current date and time is: ${new Date().toLocaleString()}`,
    prompt: `Message History:
${context.getMessageHistory()}

Based on this context, choose the next action:
1. If specific factual gaps remain in the search history, use 'continue' with feedback naming what is missing
2. If the summaries contain enough to answer (even partially), use 'answer'
3. Never choose 'answer' if the search history is empty
4. Prefer 'answer' over 'continue' when in doubt — do not search again for work the answer step can do

Here is the search history:

${context.getSearchHistory()}

Respond with ONLY a JSON object. No other text, no explanation, no markdown code fences.

Examples:
{"title":"Continuing research","reasoning":"No summaries mention platform-specific macOS audio APIs.","type":"continue","feedback":"Search history lacks macOS-specific implementation details for audio capture."}
{"title":"Providing answer","reasoning":"Summaries cover setup steps and key APIs; the answer step can synthesize them.","type":"answer"}`,
    experimental_telemetry: langfuseTelemetry("get-next-action", telemetry),
  });

  return result.output;
};
