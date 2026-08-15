import { smoothStream, streamText } from "ai";
import { markdownJoinerTransform } from "~/markdown-joiner-transform";
import { langfuseTelemetry, type LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import { model } from "~/model";
import { SystemContext } from "~/system-context";

type AgentStreamResult = ReturnType<typeof streamText>;

export function answerQuestion(
  ctx: SystemContext,
  opts: {
    isFinal?: boolean;
    telemetry?: LangfuseTelemetryOpts;
  },
): AgentStreamResult {
  const { isFinal = false, telemetry } = opts;

  return streamText({
    model,
    system: `You are a helpful AI assistant that answers questions based on the conversation history and information gathered from web searches.

When answering:
1. Read the full message history — follow-up messages like "that's not working" refer to earlier messages
2. Be thorough but concise
3. Always cite your sources using markdown links
4. If you're unsure about something, say so
5. Format URLs as markdown links using [title](url)
6. Never include raw URLs

${
  isFinal
    ? "Note: We may not have all the information needed to answer the question completely. Please provide your best attempt at an answer based on the available information."
    : ""
}`,
    prompt: `Message History:
${ctx.getMessageHistory()}

Based on the message history and the following search results, answer the user's latest message.
If the results are incomplete, say what you know and what is still uncertain.

${ctx.getSearchHistory()}`,
    experimental_transform: [
      smoothStream({
        delayInMs: 0,
        chunking: "line",
      }),
      markdownJoinerTransform(),
    ],
    experimental_telemetry: langfuseTelemetry(
      isFinal ? "answer-question-final" : "answer-question",
      telemetry,
    ),
  });
}
