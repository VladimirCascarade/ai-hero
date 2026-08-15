import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { langfuseTelemetry, type LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import { SystemContext } from "~/system-context";

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Searching Saka's injury history', 'Checking HMRC industrial action', 'Comparing toaster ovens'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["search", "answer"]).describe(
    `The type of action to take.
      - 'search': Search the web for more information. Results will include scraped page content.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  query: z
    .string()
    .describe("The query to search for. Required if type is 'search'.")
    .optional(),
  body: z
    .string()
    .describe(
      "The answer to the user's question, formatted as markdown or HTML. Required if type is 'answer'.",
    )
    .optional(),
});

export type Action = z.infer<typeof actionSchema>;

export const getNextAction = async (
  context: SystemContext,
  telemetry?: LangfuseTelemetryOpts,
) => {
  const result = await generateText({
    model,
    output: Output.object({ schema: actionSchema }),
    system: `You are a helpful AI assistant with access to real-time web search. Your job is to choose the next best action to take based on the conversation so far.

The current date and time is: ${new Date().toLocaleString()}

When deciding on the next action:
1. Read the full message history — follow-up messages like "that's not working" refer to earlier messages
2. Search the web for up-to-date information when you need more information
3. When searching, write queries that include context from the conversation, not just the latest message
4. Each search automatically fetches and scrapes the top results — you do not need a separate scrape step
5. Answer when you have enough information to respond to the user's latest message
6. Be thorough but concise - if you're unsure about something, search the web to verify
7. Use the current date to consider how recent your information needs to be
8. Always provide a concise title and clear reasoning for your chosen action`,
    prompt: `Message History:
${context.getMessageHistory()}

Based on this context, choose the next action:
1. If you need more information, use 'search' with a relevant query
2. If you have enough information to answer the question, use 'answer'
3. Never choose 'answer' if the search history is empty — search first

Here is the search history:

${context.getSearchHistory()}

Respond with ONLY a JSON object. No other text, no explanation, no markdown code fences.

Examples:
{"title": "Searching TypeScript releases", "reasoning": "I need up-to-date release information.", "type": "search", "query": "latest TypeScript release"}
{"title": "Answering the question", "reasoning": "I have enough information to answer.", "type": "answer"}`,
    experimental_telemetry: langfuseTelemetry("get-next-action", telemetry),
  });

  return result.output;
};
