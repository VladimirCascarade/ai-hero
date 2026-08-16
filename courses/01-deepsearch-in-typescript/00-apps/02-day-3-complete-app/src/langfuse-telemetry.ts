import type { TelemetrySettings } from "ai";

export type LangfuseTelemetryOpts = {
  langfuseTraceId?: string;
  /** Custom keys shown in Langfuse observation metadata (reserved keys are mapped elsewhere). */
  metadata?: Record<string, string>;
};

export function langfuseTelemetry(
  functionId: string,
  opts?: LangfuseTelemetryOpts,
): TelemetrySettings | undefined {
  if (!opts?.langfuseTraceId) {
    return undefined;
  }

  return {
    isEnabled: true,
    functionId,
    metadata: {
      langfuseTraceId: opts.langfuseTraceId,
      ...opts.metadata,
    },
  };
}
