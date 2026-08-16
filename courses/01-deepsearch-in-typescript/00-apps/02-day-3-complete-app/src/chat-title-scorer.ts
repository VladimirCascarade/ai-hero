import { createScorer } from "evalite";
import { generateText, Output } from "ai";
import { z } from "zod";
import { summarizationModel } from "./model";

export const TitleLength = createScorer<string, string, string>({
  name: "TitleLength",
  scorer: async ({ output }) => {
    const length = output.trim().length;

    return {
      score: length > 0 && length <= 50 ? 1 : 0,
      metadata: { length },
    };
  },
});

export const NotTruncatedInput = createScorer<string, string, string>({
  name: "NotTruncatedInput",
  scorer: async ({ input, output }) => {
    const normalizedOutput = output.trim();
    const truncatedInput = input.slice(0, 50);
    const isTruncatedCopy =
      normalizedOutput === truncatedInput ||
      normalizedOutput === `${truncatedInput}...` ||
      normalizedOutput.startsWith(`${input.slice(0, 40)}`);

    return {
      score: isTruncatedCopy ? 0 : 1,
    };
  },
});

export const TitleRelevancy = createScorer<string, string, string>({
  name: "TitleRelevancy",
  scorer: async ({ input, expected, output }) => {
    const { output: verdict } = await generateText({
      model: summarizationModel,
      output: Output.object({
        schema: z.object({
          verdict: z.enum(["yes", "unsure", "no"]),
          reason: z.string(),
        }),
      }),
      system: `You evaluate generated chat titles.
A good title captures the main topic of the user's message in concise natural language.
It should read like a sidebar label, not a copy-pasted snippet of the message.`,
      prompt: `User message:
${input}

Reference topic:
${expected}

Generated title:
${output}

Does the generated title appropriately summarize the user's message?

- "yes": clearly about the same topic
- "unsure": partially related or vague but not misleading
- "no": unrelated, empty, or just truncates the message`,
    });

    const scoreMap = {
      yes: 1,
      unsure: 0.5,
      no: 0,
    };

    return {
      score: scoreMap[verdict.verdict],
      metadata: verdict,
    };
  },
});
