import type { UIMessage } from "ai";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
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
import { messageToString } from "~/utils";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

const rateLimitConfig: RateLimitConfig = {
  maxRequests: 5,
  maxRetries: 3,
  windowMs: 170_000,
  keyPrefix: "chat",
};

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rateLimitCheck = await checkRateLimit(rateLimitConfig);

  if (!rateLimitCheck.allowed) {
    const isAllowed = await rateLimitCheck.retry();

    if (!isAllowed) {
      return new Response("Rate limit exceeded", {
        status: 429,
      });
    }
  }

  const body = (await request.json()) as {
    messages: Array<UIMessage>;
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

  if (isNewChat) {
    const lastMessage = messages[messages.length - 1]!;
    const upsertChatInitialInput = {
      userId: session.user.id,
      chatId,
      title: messageToString(lastMessage).slice(0, 50) + "...",
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

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (isNewChat) {
        writer.write({
          type: "data-new-chat-created",
          data: { chatId },
          transient: true,
        });
      }

      const result = await streamFromDeepSearch({
        messages,
        telemetry: {
          isEnabled: true,
          functionId: "chat-agent-api-route",
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
    onFinish: async (response) => {
      const entireConversation = [...messages, ...response.messages];
      const lastMessage = entireConversation[entireConversation.length - 1];

      if (!lastMessage) {
        return;
      }

      const upsertChatFinalInput = {
        userId: session.user.id,
        chatId,
        title: messageToString(lastMessage).slice(0, 50) + "...",
        messages: entireConversation,
      };
      const upsertChatFinalSpan = trace.span({
        name: "upsert-chat-final",
        input: upsertChatFinalInput,
      });
      const result = await upsertChat(upsertChatFinalInput);
      upsertChatFinalSpan.end({ output: result });

      await langfuse.flushAsync();
      await recordRateLimit(rateLimitConfig);
    },
  });

  return createUIMessageStreamResponse({
    stream,
  });
}
