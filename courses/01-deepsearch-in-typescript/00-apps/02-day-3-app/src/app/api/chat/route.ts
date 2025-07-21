import type { Message } from "ai";
import { createDataStreamResponse, appendResponseMessages } from "ai";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { streamFromDeepSearch } from "~/deep-search";
import {
  checkRateLimit,
  recordRateLimit,
  type RateLimitConfig,
} from "~/server/redis/checkRateLimit";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

const rateLimitConfig: RateLimitConfig = {
  maxRequests: 5,
  maxRetries: 3,
  windowMs: 170_000, // 60 seconds
  keyPrefix: "chat",
};

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Check rate limit before processing the request
  const rateLimitCheck = await checkRateLimit(rateLimitConfig);
  console.log(">>>Rate limit check status: ", rateLimitCheck);

  if (!rateLimitCheck.allowed) {
    console.log("Rate limit exceeded, waiting...");
    const isAllowed = await rateLimitCheck.retry();

    if (!isAllowed) {
      return new Response("Rate limit exceeded", {
        status: 429,
      });
    }
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

      const result = streamFromDeepSearch({
        messages,
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

          // Record the request after successful rate limit check
          await recordRateLimit(rateLimitConfig);
        },
        telemetry: {
          isEnabled: true,
          functionId: `chat-agent-api-route`,
          metadata: {
            langfuseTraceId: trace.id,
          },
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
