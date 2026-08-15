import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type TelemetrySettings,
} from "ai";
import { model } from "./model";
import { z } from "zod";
import { searchSerper } from "./serper";
import { env } from "./env";
import { bulkCrawlWebsites } from "./server/scraper";
import { cacheWithRedis } from "./server/redis/redis";

export const systemPrompt = `You are a helpful AI assistant with access to real-time web search and web page scraping capabilities. When answering questions:

1. The current date and time is: ${new Date().toLocaleString()}
2. Always search the web for up-to-date information when relevant
3. ALWAYS format URLs as markdown links using the format [title](url)
4. Be thorough but concise in your responses
5. If you're unsure about something, search the web to verify
6. When providing information, always include the source where you found it using markdown links
7. Never include raw URLs - always use markdown link format
8. Always include source links in results. You are not allowed to return results without this information.
9. Use the searchWeb tool to search for information, and use the scrapePages tool to extract the full text (in markdown) from a list of URLs when you need more detail than the search snippet provides. Use scrapePages for in-depth content extraction from web pages, especially when summarizing or analyzing full articles.
10. Always use the current date to provide context for how recent the information is, especially when discussing time-sensitive or up-to-date topics. If you reference news, events, or data, clarify how recent your sources are relative to the current date.

When using the scrapePages tool, follow these steps:
- Scrape ${env.SCRAPE_URLS_COUNT} URLs per query.
- Select a diverse set of sources:
  - Use different domains.
  - Include various perspectives.
  - Choose different types of sites (e.g., news, blogs, official sources).
- Provide a well-rounded answer by synthesizing information from these diverse sources.
`;

export const streamFromDeepSearch = async (opts: {
  messages: UIMessage[];
  telemetry: TelemetrySettings;
}) => {
  const modelMessages = await convertToModelMessages(opts.messages);

  return streamText({
    model,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    system: systemPrompt,
    tools: {
      searchWeb: tool({
        description: "Search the web for information",
        inputSchema: z.object({
          query: z.string().describe("The query to search the web for"),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: env.SEARCH_RESULTS_COUNT },
            abortSignal,
          );
          return results.organic.map((result) => ({
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            date: result.date,
          }));
        },
      }),
      scrapePages: tool({
        description:
          "Scrape full page content in markdown format from a list of URLs",
        inputSchema: z.object({
          urls: z
            .array(z.string())
            .describe(
              "A list of URLs to scrape for full page content in markdown format.",
            ),
        }),
        execute: cacheWithRedis("scrapePages", async ({ urls }) => {
          const result = await bulkCrawlWebsites({ urls });
          return result.results.map(({ url, result }) =>
            result.success
              ? { url, markdown: result.data }
              : { url, error: result.error },
          );
        }),
      }),
    },
    experimental_telemetry: opts.telemetry,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  const result = await streamFromDeepSearch({
    messages,
    telemetry: {
      isEnabled: false,
    },
  });
  await result.consumeStream();
  return await result.text;
}
