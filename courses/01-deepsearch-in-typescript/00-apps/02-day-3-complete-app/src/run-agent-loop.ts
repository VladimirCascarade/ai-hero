import type { UIMessageStreamWriter } from "ai";
import { streamText } from "ai";
import { answerQuestion } from "~/answer-question";
import { env } from "~/env";
import {
  checkIsSafe,
  CLARIFICATION_SYSTEM,
  DEFAULT_REFUSAL_MESSAGE,
} from "~/guardrails";
import { getNextAction } from "~/get-next-action";
import { guardrailModel } from "~/model";
import { queryRewriter } from "~/query-rewriter";
import { SystemContext, type SearchHistoryEntry } from "~/system-context";
import { summarizeURL } from "~/summarize-url";
import {
  langfuseTelemetry,
  type LangfuseTelemetryOpts,
} from "~/langfuse-telemetry";
import { toUsageDataPart } from "~/token-usage";
import type { OurMessage, Source } from "~/types";
import { getSearchFn, type WebSearchResult } from "~/web-search";

const faviconFor = (url: string): string | undefined => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`;
  } catch {
    return undefined;
  }
};

const summarizeSearchResults = async (
  ctx: SystemContext,
  query: string,
  results: WebSearchResult[],
  telemetry?: LangfuseTelemetryOpts,
) => {
  const summarizedResults = await Promise.all(
    results.map(async (result) => {
      if (!result.scrapedContent.trim()) {
        return {
          ...result,
          summary: "No content returned from search.",
        };
      }

      const { text, usage } = await summarizeURL(
        {
          conversation: ctx.getMessageHistory(),
          scrapedContent: result.scrapedContent,
          searchMetadata: {
            date: result.date,
            title: result.title,
            url: result.url,
          },
          query,
        },
        telemetry,
      );

      if (usage) {
        ctx.reportUsage("summarize-url", usage);
      }

      return { ...result, summary: text };
    }),
  );

  ctx.reportSearch({ query, results: summarizedResults } satisfies SearchHistoryEntry);
};

type AgentStreamResult = ReturnType<typeof streamText>;

export type AgentLoopResult = {
  result: AgentStreamResult;
};

const attachStreamUsage = (
  ctx: SystemContext,
  result: AgentStreamResult,
  descriptor: string,
  onReported?: () => void,
) => {
  void result.usage.then((usage) => {
    if (usage) {
      ctx.reportUsage(descriptor, usage);
      onReported?.();
    }
  });
};

export async function runAgentLoop(
  ctx: SystemContext,
  opts: {
    telemetry?: LangfuseTelemetryOpts;
    writeMessagePart: UIMessageStreamWriter<OurMessage>["write"];
  },
): Promise<AgentLoopResult> {
  const search = getSearchFn();
  const usageDataPartId = crypto.randomUUID();

  const emitUsage = () => {
    const data = toUsageDataPart(ctx.getTotalTokens());
    if (data.totalTokens <= 0) {
      return;
    }

    opts.writeMessagePart({
      id: usageDataPartId,
      type: "data-usage",
      data,
    });
  };

  const answerQuestionWithUsage = (answerOpts: {
    isFinal?: boolean;
    telemetry?: LangfuseTelemetryOpts;
  }) => {
    emitUsage();
    return answerQuestion(ctx, {
      ...answerOpts,
      onUsageReported: () => emitUsage(),
    });
  };

  const guardrailResult = await checkIsSafe(ctx, opts.telemetry);
  if (guardrailResult.classification === "refuse") {
    const refusalMessage =
      guardrailResult.reason ?? DEFAULT_REFUSAL_MESSAGE;

    emitUsage();

    const result = streamText({
      model: guardrailModel,
      system:
        "Output the following message to the user verbatim. Do not add any other text.",
      prompt: refusalMessage,
      experimental_telemetry: langfuseTelemetry(
        "guardrail-refusal",
        opts.telemetry,
      ),
    });

    attachStreamUsage(ctx, result, "guardrail-refusal", () => emitUsage());

    return { result };
  }

  if (guardrailResult.classification === "clarify" && !ctx.shouldSkipClarification()) {
    emitUsage();

    const result = streamText({
      model: guardrailModel,
      system: CLARIFICATION_SYSTEM,
      prompt: `Message history:
${ctx.getMessageHistory()}

Why clarification is needed: ${guardrailResult.reason}`,
      experimental_telemetry: langfuseTelemetry(
        "guardrail-clarification",
        opts.telemetry,
      ),
    });

    attachStreamUsage(ctx, result, "guardrail-clarification", () =>
      emitUsage(),
    );

    return { result };
  }

  const maxDurationMs = env.MAX_DURATION_SECONDS * 1000;
  const deadline = Date.now() + maxDurationMs * 0.8;
  const isNearDeadline = () => Date.now() >= deadline;

  const answerWithTimeout = () => {
    opts.writeMessagePart({
      type: "data-new-action",
      data: {
        title: "Answering the question (time limit)",
        reasoning:
          "Running low on time — answering with the research collected so far.",
        type: "answer",
      },
    });
    return answerQuestionWithUsage({ isFinal: true, telemetry: opts.telemetry });
  };

  const answerAfterSteps = () => {
    opts.writeMessagePart({
      type: "data-new-action",
      data: {
        title: "Answering the question",
        reasoning:
          ctx.getStopReason() === "budget"
            ? "The session token budget has been reached — answering with the research collected so far."
            : "I've completed my research steps and will now provide an answer based on what I've found.",
        type: "answer",
      },
    });
    return answerQuestionWithUsage({ isFinal: true, telemetry: opts.telemetry });
  };

  while (!ctx.shouldStop()) {
    if (isNearDeadline()) {
      return { result: answerWithTimeout() };
    }

    const { plan, queries } = await queryRewriter(ctx, opts.telemetry);

    opts.writeMessagePart({
      type: "data-research-plan",
      data: { plan, queries },
    });

    const cap = env.SCRAPE_URLS_COUNT;
    const seenUrls = new Set<string>();
    const sources: Source[] = [];
    const allResults: Array<{ query: string; results: WebSearchResult[] }> =
      [];
    let collected = 0;

    for (const query of queries) {
      if (collected >= cap || isNearDeadline()) break;

      const rawResults = await search(query, cap - collected);

      const results = rawResults
        .filter((result) => !seenUrls.has(result.url))
        .slice(0, cap - collected);

      if (results.length === 0) continue;

      for (const result of results) {
        seenUrls.add(result.url);
        sources.push({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          favicon: faviconFor(result.url),
        });
      }

      collected += results.length;
      allResults.push({ query, results });
    }

    if (sources.length > 0) {
      opts.writeMessagePart({
        type: "data-sources",
        data: sources,
      });
    }

    for (const { query, results } of allResults) {
      if (isNearDeadline()) break;
      await summarizeSearchResults(ctx, query, results, opts.telemetry);
    }

    emitUsage();

    if (ctx.getStopReason() === "budget") {
      return { result: answerAfterSteps() };
    }

    if (isNearDeadline()) {
      return { result: answerWithTimeout() };
    }

    const nextAction = await getNextAction(ctx, opts.telemetry);

    if (nextAction.feedback) {
      ctx.setLastFeedback(nextAction.feedback);
    }

    opts.writeMessagePart({
      type: "data-new-action",
      data: nextAction,
    });

    emitUsage();

    if (nextAction.type === "answer") {
      return {
        result: answerQuestionWithUsage({
          isFinal: false,
          telemetry: opts.telemetry,
        }),
      };
    }

    if (ctx.getStopReason() === "budget") {
      return { result: answerAfterSteps() };
    }

    ctx.incrementStep();
  }

  return { result: answerAfterSteps() };
}
