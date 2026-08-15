import type { UIMessage, UIMessageStreamWriter } from "ai";
import { streamText } from "ai";
import { runAgentLoop } from "./run-agent-loop";
import type { LangfuseTelemetryOpts } from "./langfuse-telemetry";
import type { OurMessage } from "./types";

type DeepSearchStreamResult = ReturnType<typeof streamText>;

export const streamFromDeepSearch = async (opts: {
  messages: UIMessage[];
  telemetry?: LangfuseTelemetryOpts;
  writeMessagePart: UIMessageStreamWriter<OurMessage>["write"];
}): Promise<DeepSearchStreamResult> => {
  if (!opts.messages.some((message) => message.role === "user")) {
    throw new Error("No user message found");
  }

  return runAgentLoop(opts.messages, {
    telemetry: opts.telemetry,
    writeMessagePart: opts.writeMessagePart,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  const result = await streamFromDeepSearch({
    messages,
    writeMessagePart: () => {},
  });

  await result.consumeStream();
  return await result.text;
}
