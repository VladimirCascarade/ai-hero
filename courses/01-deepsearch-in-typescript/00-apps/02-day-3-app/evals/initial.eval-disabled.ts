import { evalite } from "evalite";
import { askDeepSearch } from "../src/deep-search";
import type { Message } from "ai";
import { Factuality } from "~/factuality-scorer";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    return [
      {
        input: "What is the latest version of TypeScript?",
        expected: "The current TypeScript version is 5.8",
      },
      {
        input: "What are the main features of Next.js 15?",
        expected:
          "Main features: @next/codemod CLI, Async Request APIs, Caching Semantics, React 19 Support, Turbopack Dev, Static Indicator, unstable_after API, instrumentation.js API, Enhanced Forms, next.config TypeScript support, Self-hosting Improvements, Server Actions Security, Bundling External Packages, ESLint 9 Support, Build and Fast Refresh improvements.",
      },
    ];
  },
  task: async (input) => {
    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: input,
      },
    ];
    return askDeepSearch(messages);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links!",
      scorer: ({ output }) => {
        // Regular expression to match markdown links [text](url)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
  ],
});
