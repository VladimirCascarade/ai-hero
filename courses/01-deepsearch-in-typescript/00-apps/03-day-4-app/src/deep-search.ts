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
import { bulkCrawlWebsites } from "./server/scraper";

export const streamFromDeepSearch = async (opts: {
  messages: UIMessage[];
  telemetry: TelemetrySettings;
}) => {
  const modelMessages = await convertToModelMessages(opts.messages);

  return streamText({
    model,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    system: `You are a helpful AI assistant with access to real-time web search capabilities. The current date and time is ${new Date().toLocaleString()}. When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. When users ask for up-to-date information, use the current date to provide context about how recent the information is
8. IMPORTANT: After finding relevant URLs from search results, ALWAYS use the scrapePages tool to get the full content of those pages. Never rely solely on search snippets.

Your workflow should be:
1. Use searchWeb to find 10 relevant URLs from diverse sources (news sites, blogs, official documentation, etc.)
2. Select 4-6 of the most relevant and diverse URLs to scrape
3. Use scrapePages to get the full content of those URLs
4. Use the full content to provide detailed, accurate answers

Remember to:
- Always scrape multiple sources (4-6 URLs) for each query
- Choose diverse sources (e.g., not just news sites or just blogs)
- Prioritize official sources and authoritative websites
- Use the full content to provide comprehensive answers`,
    tools: {
      searchWeb: tool({
        description: "Search the web for information",
        inputSchema: z.object({
          query: z.string().describe("The query to search the web for"),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: 10 },
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
        description: "Scrape full page content from a list of URLs",
        inputSchema: z.object({
          urls: z.array(z.string()).describe("The URLs to scrape"),
        }),
        execute: async ({ urls }) => {
          const results = await bulkCrawlWebsites({ urls });

          if (!results.success) {
            return {
              error: results.error,
              results: results.results.map(({ url, result }) => ({
                url,
                success: result.success,
                data: result.success ? result.data : result.error,
              })),
            };
          }

          return {
            results: results.results.map(({ url, result }) => ({
              url,
              success: result.success,
              data: result.data,
            })),
          };
        },
      }),
    },
    experimental_telemetry: opts.telemetry,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  const result = await streamFromDeepSearch({
    messages,
    telemetry: { isEnabled: false },
  });
  await result.consumeStream();
  return await result.text;
}
