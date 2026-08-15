// Note: You'll want to modify these evals, since they may be out of date.
// You should choose your own evals because we are actively testing for recency.

import type { UIMessage } from "ai";
import { evalite } from "evalite";
import { askDeepSearch } from "~/deep-search";
import { Factuality } from "~/factuality-scorer";
import { AnswerRelevancy } from "../src/answer-relevancy-scorer";
import { devData } from "./dev";
import { ciData } from "./ci";
import { regressionData } from "./regression";
import { env } from "../src/env";

// Dynamically resolve data based on EVAL_DATASET
const data = [...devData];
if (env.EVAL_DATASET === "ci") {
  data.push(...ciData);
} else if (env.EVAL_DATASET === "regression") {
  data.push(...ciData, ...regressionData);
}

evalite("Arsenal", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    return data;
  },
  task: async (input) => {
    const messages: UIMessage[] = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: input }],
      },
    ];
    return askDeepSearch(messages);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Regular expression to match markdown links [text](url)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
    AnswerRelevancy,
  ],
});
