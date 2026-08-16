import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { env } from "~/env";
import { langfuseTelemetry, type LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import { model } from "~/model";
import { SystemContext } from "~/system-context";
import { parseStructuredOutput } from "~/utils";

const queryCount = env.SEARCH_RESULTS_COUNT;

export const queryRewriterSchema = z.object({
  plan: z
    .string()
    .describe(
      "A detailed research plan describing how to approach answering the question.",
    ),
  queries: z
    .array(z.string())
    .length(queryCount)
    .describe(
      `${queryCount} sequential search queries to execute, each serving a specific purpose in the plan.`,
    ),
});

export type QueryRewriterResult = z.infer<typeof queryRewriterSchema>;

export const queryRewriter = async (
  context: SystemContext,
  telemetry?: LangfuseTelemetryOpts,
): Promise<QueryRewriterResult> => {
  const lastFeedback = context.getLastFeedback();
  const exampleQueries = [
    "botanical definition of fruit tomato",
    "why tomatoes are culinary vegetables",
    "Nix v Hedden tomato ruling summary",
    "fourth query example",
    "fifth query example",
  ].slice(0, queryCount);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: queryRewriterSchema }),
      system: `You are a strategic research planner with expertise in breaking down complex questions into logical search steps. Your primary role is to create a detailed research plan before generating any search queries.

First, analyze the question thoroughly:
- Break down the core components and key concepts
- Identify any implicit assumptions or context needed
- Consider what foundational knowledge might be required
- Think about potential information gaps that need filling

Then, develop a strategic research plan that:
- Outlines the logical progression of information needed
- Identifies dependencies between different pieces of information
- Considers multiple angles or perspectives that might be relevant
- Anticipates potential dead-ends or areas needing clarification

Finally, translate this plan into exactly ${queryCount} sequential search queries that:
- Are specific and focused (avoid broad queries that return general information)
- Are written in natural language without Boolean operators (no AND/OR)
- Progress logically from foundational to specific information
- Build upon each other in a meaningful way

Remember that initial queries can be exploratory - they help establish baseline information or verify assumptions before proceeding to more targeted searches. Each query should serve a specific purpose in your overall research plan.`,
      prompt: `Based on this context, create a research plan and generate exactly ${queryCount} search queries that will help answer the user's latest message.

Respond with ONLY a JSON object. No markdown, no headings, no code fences.

Example:
{"plan":"Research the botanical and culinary definitions...","queries":${JSON.stringify(exampleQueries)}}

---

Message History:
${context.getMessageHistory()}

Search History:
${context.getSearchHistory() || "(none yet)"}
${lastFeedback ? `\nLast feedback from evaluation:\n${lastFeedback}` : ""}

Current date and time: ${new Date().toLocaleString()}`,
      experimental_telemetry: langfuseTelemetry("query-rewriter", telemetry),
    });

    context.reportUsage("query-rewriter", result.usage);

    return result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) && error.text) {
      const recovered = parseStructuredOutput(queryRewriterSchema, error.text);
      if (recovered) {
        return recovered;
      }
    }

    throw error;
  }
};
