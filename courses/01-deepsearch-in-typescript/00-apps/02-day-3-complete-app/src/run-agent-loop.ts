import type { UIMessage, UIMessageStreamWriter } from "ai";
import { streamText } from "ai";
import { answerQuestion } from "~/answer-question";
import { env } from "~/env";
import { getNextAction, type Action } from "~/get-next-action";
import { searchSerper } from "~/serper";
import { cacheWithRedis } from "~/server/redis/redis";
import { bulkCrawlWebsites } from "~/server/scraper";
import { SystemContext, type SearchHistoryEntry } from "~/system-context";
import type { LangfuseTelemetryOpts } from "~/langfuse-telemetry";
import type { OurMessage } from "~/types";

const scrapePages = cacheWithRedis(
  "scrapePages",
  async ({ urls }: { urls: string[] }) => {
    const result = await bulkCrawlWebsites({ urls });

    return result.results.map(({ url, result }) =>
      result.success
        ? { url, markdown: result.data }
        : { url, error: result.error },
    );
  },
);

const searchAndScrape = cacheWithRedis(
  "searchAndScrape",
  async ({ query }: { query: string }): Promise<SearchHistoryEntry> => {
    const serperResults = await searchSerper(
      { q: query, num: env.SEARCH_RESULTS_COUNT },
      undefined,
    );

    const organic = serperResults.organic.slice(0, env.SEARCH_RESULTS_COUNT);
    const urls = organic.map((result) => result.link);
    const scrapeResults = urls.length > 0 ? await scrapePages({ urls }) : [];

    const scrapedContentByUrl = new Map(
      scrapeResults.map((result) => [
        result.url,
        "markdown" in result ? result.markdown : `Error: ${result.error}`,
      ]),
    );

    return {
      query,
      results: organic.map((result) => ({
        date: result.date || new Date().toISOString(),
        title: result.title,
        url: result.link,
        snippet: result.snippet,
        scrapedContent: scrapedContentByUrl.get(result.link) ?? "",
      })),
    };
  },
);

type AgentStreamResult = ReturnType<typeof streamText>;

export async function runAgentLoop(
  messages: UIMessage[],
  opts: {
    telemetry?: LangfuseTelemetryOpts;
    writeMessagePart: UIMessageStreamWriter<OurMessage>["write"];
  },
): Promise<AgentStreamResult> {
  const ctx = new SystemContext(messages);

  while (!ctx.shouldStop()) {
    let nextAction = await getNextAction(ctx, opts.telemetry);

    if (
      nextAction.type === "answer" &&
      !ctx.hasResearch() &&
      !ctx.isFollowUp()
    ) {
      const query = ctx.getLatestUserMessage();
      nextAction = {
        title: "Searching the web",
        reasoning:
          "I need to search for information before I can answer this question.",
        type: "search",
        query,
      } satisfies Action;
    }

    opts.writeMessagePart({
      type: "data-new-action",
      data: nextAction,
    });

    if (nextAction.type === "search") {
      if (!nextAction.query) {
        throw new Error("Query is required for search action");
      }

      const searchResult = await searchAndScrape({ query: nextAction.query });
      ctx.reportSearch(searchResult);
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false, ...opts });
    }

    ctx.incrementStep();
  }

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
}
