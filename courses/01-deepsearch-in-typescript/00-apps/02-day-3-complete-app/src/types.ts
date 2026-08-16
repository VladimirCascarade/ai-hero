import type { UIMessage } from "ai";
import type { Action } from "./get-next-action";

export type ResearchPlan = {
  plan: string;
  queries: string[];
};

export type Source = {
  title: string;
  url: string;
  snippet: string;
  favicon?: string;
};

export type OurMessage = UIMessage<
  never,
  {
    "new-action": Action;
    "research-plan": ResearchPlan;
    sources: Source[];
    "new-chat-created": {
      chatId: string;
    };
  }
>;
