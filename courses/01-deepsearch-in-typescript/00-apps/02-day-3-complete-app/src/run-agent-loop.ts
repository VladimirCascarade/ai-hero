import type { UIMessage, UIMessageStreamWriter } from "ai";
import { streamText } from "ai";
import { answerQuestion } from "~/answer-question";
import { env } from "~/env";
import { getNextAction } from "~/get-next-action";
import { queryRewriter } from "~/query-rewriter";
import { SystemContext, type SearchHistoryEntry } from "~/system-context";
import { summarizeURL } from "~/summarize-url";
import { searchTavily } from "~/tavily";
import type { LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import type { OurMessage, Source } from "~/types";

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
  results: Array<{
    date: string;
    title: string;
    url: string;
    snippet: string;
    scrapedContent: string;
  }>,
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

      const summary = await summarizeURL(
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

      return { ...result, summary };
    }),
  );

  ctx.reportSearch({ query, results: summarizedResults } satisfies SearchHistoryEntry);
};

type AgentStreamResult = ReturnType<typeof streamText>;

export async function runAgentLoop(
  messages: UIMessage[],
  opts: {
    telemetry?: LangfuseTelemetryOpts;
    writeMessagePart: UIMessageStreamWriter<OurMessage>["write"];
  },
): Promise<AgentStreamResult> {
  const ctx = new SystemContext(messages);
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
    return answerQuestion(ctx, { isFinal: true, ...opts });
  };

  const answerAfterSteps = () => {
    opts.writeMessagePart({
      type: "data-new-action",
      data: {
        title: "Answering the question",
        reasoning:
          "I've completed my research steps and will now provide an answer based on what I've found.",
        type: "answer",
      },
    });
    return answerQuestion(ctx, { isFinal: true, ...opts });
  };

  while (!ctx.shouldStop()) {
    if (isNearDeadline()) {
      return answerWithTimeout();
    }

    const { plan, queries } = await queryRewriter(ctx, opts.telemetry);

    opts.writeMessagePart({
      type: "data-research-plan",
      data: { plan, queries },
    });

    const cap = env.SCRAPE_URLS_COUNT;
    const seenUrls = new Set<string>();
    const sources: Source[] = [];
    let collected = 0;

    for (const query of queries) {
      if (collected >= cap || isNearDeadline()) break;

      const response = await searchTavily({
        query,
        num: cap - collected,
      });

      const results = response.results
        .filter((result) => !seenUrls.has(result.url))
        .slice(0, cap - collected)
        .map((result) => ({
          date: new Date().toISOString(),
          title: result.title,
          url: result.url,
          snippet: result.content,
          scrapedContent: result.rawContent ?? result.content ?? "",
        }));

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
      await summarizeSearchResults(ctx, query, results, opts.telemetry);
    }

    if (sources.length > 0) {
      opts.writeMessagePart({
        type: "data-sources",
        data: sources,
      });
    }

    if (isNearDeadline()) {
      return answerWithTimeout();
    }

    const nextAction = await getNextAction(ctx, opts.telemetry);

    if (nextAction.feedback) {
      ctx.setLastFeedback(nextAction.feedback);
    }

    opts.writeMessagePart({
      type: "data-new-action",
      data: nextAction,
    });

    if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false, ...opts });
    }

    ctx.incrementStep();
  }

  return answerAfterSteps();
};
