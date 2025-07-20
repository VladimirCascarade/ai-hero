import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";
import { z } from "zod";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { bulkCrawlWebsites } from "~/server/scraper";
import { cacheWithRedis } from "~/server/redis/redis";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId: string;
    isNewChat: boolean;
  };

  const { messages, chatId, isNewChat } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  const trace = langfuse.trace({
    sessionId: chatId,
    name: "chat",
    userId: session.user.id,
  });

  // If no chatId is provided, create a new chat with the user's message
  if (isNewChat) {
    const upsertChatInitialInput = {
      userId: session.user.id,
      chatId,
      title: messages[messages.length - 1].content.slice(0, 50) + "...",
      messages,
    };
    const upsertChatInitialSpan = trace.span({
      name: "upsert-chat-initial",
      input: upsertChatInitialInput,
    });
    const result = await upsertChat(upsertChatInitialInput);
    upsertChatInitialSpan.end({ output: result });
  } else {
    const findChatInput = { chatId };
    const findChatSpan = trace.span({
      name: "find-chat",
      input: findChatInput,
    });
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, findChatInput.chatId),
    });
    findChatSpan.end({ output: chat });
    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // If this is a new chat, send the chat ID to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: chatId,
        });
      }

      const result = streamText({
        model,
        messages,
        maxSteps: 10,
        experimental_telemetry: {
          isEnabled: true,
          functionId: `chat-agent-api-route`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
        system: `You are a helpful AI assistant with access to real-time web search and web page scraping capabilities. When answering questions:

The current date and time is: ${new Date().toLocaleString()}

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. Use the searchWeb tool to search for information, and use the scrapePages tool to extract the full text (in markdown) from a list of URLs when you need more detail than the search snippet provides. Use scrapePages for in-depth content extraction from web pages, especially when summarizing or analyzing full articles.
8. Always use the current date to provide context for how recent the information is, especially when discussing time-sensitive or up-to-date topics. If you reference news, events, or data, clarify how recent your sources are relative to the current date.

When using the scrapePages tool, follow these steps:
- Scrape 4 to 6 URLs per query.
- Select a diverse set of sources:
  - Use different domains.
  - Include various perspectives.
  - Choose different types of sites (e.g., news, blogs, official sources).
- Provide a well-rounded answer by synthesizing information from these diverse sources.
`,
        tools: {
          searchWeb: {
            parameters: z.object({
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
        },
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            return;
          }

          const upsertChatFinalInput = {
            userId: session.user.id,
            chatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          };
          const upsertChatFinalSpan = trace.span({
            name: "upsert-chat-final",
            input: upsertChatFinalInput,
          });
          const result = await upsertChat(upsertChatFinalInput);
          upsertChatFinalSpan.end({ output: result });

          // Plugin Langfuse observability
          await langfuse.flushAsync();
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
