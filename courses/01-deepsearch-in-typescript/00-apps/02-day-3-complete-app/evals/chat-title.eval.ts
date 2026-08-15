import type { UIMessage } from "ai";
import { evalite } from "evalite";
import { chatTitleDevData } from "./chat-title-data";
import { generateChatTitle } from "~/generate-chat-title";
import {
  NotTruncatedInput,
  TitleLength,
  TitleRelevancy,
} from "~/chat-title-scorer";

evalite("Chat Title", {
  data: async () => chatTitleDevData,
  task: async (input) => {
    const messages: UIMessage[] = [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: input }],
      },
    ];

    return generateChatTitle(messages);
  },
  scorers: [TitleLength, NotTruncatedInput, TitleRelevancy],
});
