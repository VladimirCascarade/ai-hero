import type { UIMessage } from "ai";
import type { Action } from "./get-next-action";

export type OurMessage = UIMessage<
  never,
  {
    "new-action": Action;
    "new-chat-created": {
      chatId: string;
    };
  }
>;
