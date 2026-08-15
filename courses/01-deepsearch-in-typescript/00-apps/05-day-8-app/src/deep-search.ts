import { type UIMessage, type UIMessageStreamWriter } from "ai";
import { runAgentLoop } from "./run-agent-loop";
import type { OurMessage } from "./types";

export const streamFromDeepSearch = async (opts: {
  messages: UIMessage[];
  langfuseTraceId?: string;
  writeMessagePart?: UIMessageStreamWriter<OurMessage>["write"];
}) => {
  return runAgentLoop(opts.messages, {
    langfuseTraceId: opts.langfuseTraceId,
    writeMessagePart: opts.writeMessagePart,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  const result = await streamFromDeepSearch({
    messages,
    langfuseTraceId: undefined,
  });

  await result.consumeStream();

  return await result.text;
}
