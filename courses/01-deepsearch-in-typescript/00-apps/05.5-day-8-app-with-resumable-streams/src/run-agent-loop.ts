import { SystemContext } from "./system-context";
import { getNextAction } from "./get-next-action";
import { searchSerper } from "./serper";
import { bulkCrawlWebsites } from "./server/scraper";
import type { UIMessage, UIMessageStreamWriter } from "ai";
import { answerQuestion } from "./answer-question";
import type { OurMessage } from "./types";

export async function runAgentLoop(
  messages: UIMessage[],
  opts: {
    langfuseTraceId?: string;
    writeMessagePart?: UIMessageStreamWriter<OurMessage>["write"];
  },
) {
  const ctx = new SystemContext(messages);

  while (!ctx.shouldStop()) {
    const nextAction = await getNextAction(ctx, opts);

    if (opts.writeMessagePart) {
      opts.writeMessagePart({
        type: "data-new-action",
        data: nextAction,
      });
    }

    if (nextAction.type === "search") {
      if (!nextAction.query) {
        throw new Error("Query is required for search action");
      }
      const results = await searchSerper(
        { q: nextAction.query, num: 10 },
        undefined,
      );
      ctx.reportQueries([
        {
          query: nextAction.query,
          results: results.organic.map((result) => ({
            date: result.date || new Date().toISOString(),
            title: result.title,
            url: result.link,
            snippet: result.snippet,
          })),
        },
      ]);
    } else if (nextAction.type === "scrape") {
      if (!nextAction.urls) {
        throw new Error("URLs are required for scrape action");
      }
      const results = await bulkCrawlWebsites({ urls: nextAction.urls });
      if (results.success) {
        ctx.reportScrapes(
          results.results.map(({ url, result }) => ({
            url,
            result: result.data,
          })),
        );
      }
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false, ...opts });
    }

    ctx.incrementStep();
  }

  return answerQuestion(ctx, { isFinal: true, ...opts });
}
