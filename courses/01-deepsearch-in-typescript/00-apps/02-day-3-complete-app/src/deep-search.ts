import type { UIMessageStreamWriter } from "ai";
import type { UIMessage } from "ai";
import { runAgentLoop, type AgentLoopResult } from "./run-agent-loop";
import type { LangfuseTelemetryOpts } from "./langfuse-telemetry";
import { SystemContext } from "./system-context";
import type { OurMessage } from "./types";

export const streamFromDeepSearch = async (opts: {
  ctx: SystemContext;
  telemetry?: LangfuseTelemetryOpts;
  writeMessagePart: UIMessageStreamWriter<OurMessage>["write"];
}): Promise<AgentLoopResult> => {
  return runAgentLoop(opts.ctx, {
    telemetry: opts.telemetry,
    writeMessagePart: opts.writeMessagePart,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  const ctx = new SystemContext(messages);

  if (!messages.some((message) => message.role === "user")) {
    throw new Error("No user message found");
  }

  const { result } = await streamFromDeepSearch({
    ctx,
    writeMessagePart: () => {},
  });

  await result.consumeStream();
  return await result.text;
}
