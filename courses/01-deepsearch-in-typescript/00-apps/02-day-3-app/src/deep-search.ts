import { streamText, type Message, type TelemetrySettings } from "ai";
import { model } from "./model";
import { z } from "zod";
import { searchSerper } from "./serper";
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
- Scrape 4 to 6 URLs per query.
- Select a diverse set of sources:
  - Use different domains.
  - Include various perspectives.
  - Choose different types of sites (e.g., news, blogs, official sources).
- Provide a well-rounded answer by synthesizing information from these diverse sources.
`;

export const tools = {
  searchWeb: {
    parameters: z.object({
      query: z.string().describe("The query to search the web for"),
    }),
    execute: async ({ query }, { abortSignal }) => {
      const results = await searchSerper({ q: query, num: 10 }, abortSignal);
      return results.organic.map((result) => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet,
        date: result.date,
      }));
    },
  },
  scrapePages: {
    parameters: z.object({
      urls: z
        .array(z.string())
        .describe(
          "A list of URLs to scrape for full page content in markdown format.",
        ),
    }),
    execute: cacheWithRedis("scrapePages", async ({ urls }) => {
      const result = await bulkCrawlWebsites({ urls });
      // Return a map of url -> markdown or error
      return result.results.map(({ url, result }) =>
        result.success
          ? { url, markdown: result.data }
          : { url, error: result.error },
      );
    }),
  },
};

export const streamFromDeepSearch = (opts: {
  messages: Message[];
  onFinish: Parameters<typeof streamText>[0]["onFinish"];
  telemetry: TelemetrySettings;
}) =>
  streamText({
    model,
    messages: opts.messages,
    maxSteps: 10,
    system: systemPrompt,
    tools,
    onFinish: opts.onFinish,
    experimental_telemetry: opts.telemetry,
  });

export async function askDeepSearch(messages: Message[]) {
  const result = streamFromDeepSearch({
    messages,
    onFinish: () => {}, // stub
    telemetry: {
      isEnabled: false,
    },
  });
  await result.consumeStream();
  return await result.text;
}
