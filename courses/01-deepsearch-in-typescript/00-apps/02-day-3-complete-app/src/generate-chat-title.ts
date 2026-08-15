import type { UIMessage } from "ai";
import { generateText } from "ai";
import {
  langfuseTelemetry,
  type LangfuseTelemetryOpts,
} from "~/langfuse-telemetry";
import { model } from "~/model";
import { messageToString } from "~/utils";

export const generateChatTitle = async (
  messages: UIMessage[],
  telemetry?: LangfuseTelemetryOpts,
) => {
  const { text } = await generateText({
    model,
    system: `You are a chat title generator.
You will be given a chat history, and you will need to generate a title for the chat.
The title should be a single sentence that captures the essence of the chat.
The title should be no more than 50 characters.
The title should be in the same language as the chat history.
Return only the title, with no quotes or punctuation at the end.`,
    prompt: `Here is the chat history:

${messages.map((message) => `${message.role}: ${messageToString(message)}`).join("\n")}`,
    experimental_telemetry: langfuseTelemetry("generate-chat-title", telemetry),
  });

  return text.trim().slice(0, 50);
};
