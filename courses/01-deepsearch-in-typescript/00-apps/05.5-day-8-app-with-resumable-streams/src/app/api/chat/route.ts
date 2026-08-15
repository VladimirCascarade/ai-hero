import type { UIMessage } from "ai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { eq } from "drizzle-orm";
import { Langfuse } from "langfuse";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { Redis } from "ioredis";
import { streamFromDeepSearch } from "~/deep-search";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import {
  appendStreamId,
  getChat,
  getStreamIds,
  upsertChat,
} from "~/server/db/queries";
import { chats } from "~/server/db/schema";
import type { OurMessage } from "~/types";
import { messageToString } from "~/utils";

const streamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: new Redis(env.REDIS_URL),
  subscriber: new Redis(env.REDIS_URL),
});

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
    messages: Array<UIMessage>;
    chatId?: string;
  };

  const { messages, chatId } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  let currentChatId = chatId;
  if (!currentChatId) {
    currentChatId = crypto.randomUUID();
  } else {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });

    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  await upsertChat({
    userId: session.user.id,
    chatId: currentChatId,
    title:
      messageToString(messages[messages.length - 1]!).slice(0, 50) + "...",
    messages,
  });

  const trace = langfuse.trace({
    sessionId: currentChatId,
    name: "chat",
    userId: session.user.id,
  });

  const streamId = crypto.randomUUID();
  await appendStreamId({ chatId: currentChatId, streamId });

  const stream = createUIMessageStream<OurMessage>({
    execute: async ({ writer }) => {
      if (!chatId) {
        writer.write({
          type: "data-new-chat-created",
          data: {
            chatId: currentChatId,
          },
          transient: true,
        });
      }

      const result = await streamFromDeepSearch({
        messages,
        langfuseTraceId: trace.id,
        writeMessagePart: writer.write,
      });

      writer.merge(result.toUIMessageStream());

      // Consume the stream so it can be resumed after disconnect
      await result.consumeStream();
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

      await upsertChat({
        userId: session.user.id,
        chatId: currentChatId,
        title: messageToString(lastMessage).slice(0, 50) + "...",
        messages: entireConversation,
      });

      await langfuse.flushAsync();
    },
  });

  return createUIMessageStreamResponse({
    stream,
    async consumeSseStream({ stream: sseStream }) {
      await streamContext.createNewResumableStream(streamId, () => sseStream);
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!chatId) {
    return new Response("chatId is required", { status: 400 });
  }

  const chat = await getChat({ chatId, userId: session.user.id });

  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  const { mostRecentStreamId } = await getStreamIds({ chatId });

  if (!mostRecentStreamId) {
    return new Response(null, { status: 204 });
  }

  const resumedStream =
    await streamContext.resumeExistingStream(mostRecentStreamId);

  if (resumedStream) {
    return new Response(resumedStream, {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  }

  return new Response(null, { status: 204 });
}
