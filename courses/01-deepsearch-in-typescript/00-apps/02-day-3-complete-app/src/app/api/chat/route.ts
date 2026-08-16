import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { auth } from "~/server/auth";
import {
  appendStreamId,
  getChat,
  getStreamIds,
  upsertChat,
} from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { streamFromDeepSearch } from "~/deep-search";
import { GENERATING_CHAT_TITLE } from "~/chat-title";
import { generateChatTitle } from "~/generate-chat-title";
import {
  checkRateLimit,
  recordRateLimit,
  type RateLimitConfig,
} from "~/server/redis/checkRateLimit";
import type { OurMessage } from "~/types";
import { messageToString } from "~/utils";
import { streamContext } from "~/server/redis/resumable-stream-context";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

const rateLimitConfig: RateLimitConfig = {
  maxRequests: 5,
  maxRetries: 3,
  windowMs: 170_000,
  keyPrefix: "chat",
};

const getErrorMessage = (error: unknown): string => {
  const collect = (e: unknown): string => {
    if (!e || typeof e !== "object") return "";
    const o = e as {
      responseBody?: string;
      message?: string;
      lastError?: unknown;
      cause?: unknown;
    };
    return [o.responseBody, o.message, collect(o.lastError), collect(o.cause)]
      .filter(Boolean)
      .join("");
  };

  const text = collect(error);
  const match =
    text.match(/retryDelay[^0-9]*(\d+(?:\.\d+)?)s/i) ??
    text.match(/Please retry in (\d+(?:\.\d+)?)s/i);

  if (match) {
    return `Rate limit exceeded. Wait ${Math.ceil(Number.parseFloat(match[1]!))}s and try again.`;
  }

  if (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("maxDuration") ||
    text.includes("Function execution")
  ) {
    return "The request timed out. Try a simpler question or start a new chat.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
};

export const maxDuration = env.MAX_DURATION_SECONDS;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rateLimitCheck = await checkRateLimit(rateLimitConfig);

  if (!rateLimitCheck.allowed) {
    const isAllowed = await rateLimitCheck.retry();

    if (!isAllowed) {
      return Response.json(
        { error: "Too many messages. Wait a few minutes and try again." },
        { status: 429 },
      );
    }
  }

  const body = (await request.json()) as {
    messages: Array<OurMessage>;
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

  const telemetry = {
    langfuseTraceId: trace.id,
    metadata: {
      chatId,
    },
  };

  const titlePromise = isNewChat
    ? generateChatTitle(messages, telemetry)
    : Promise.resolve("");

  if (isNewChat) {
    const upsertChatInitialInput = {
      userId: session.user.id,
      chatId,
      title: GENERATING_CHAT_TITLE,
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

  const streamId = crypto.randomUUID();
  await appendStreamId({ chatId, streamId });

  const stream = createUIMessageStream<OurMessage>({
    originalMessages: messages,
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
        telemetry,
        writeMessagePart: writer.write,
      });

      writer.merge(result.toUIMessageStream({ sendStart: false }));

      try {
        await result.consumeStream();
      } catch (e) {
        console.error("consumeStream failed:", e);
        throw e;
      }
    },
    onError: (e) => {
      console.error(e);
      return getErrorMessage(e);
    },
    onFinish: async ({ messages: entireConversation }) => {
      const lastMessage = entireConversation[entireConversation.length - 1];

      if (!lastMessage) {
        return;
      }

      const generatedTitle = await titlePromise.catch(() => "");
      const fallbackTitle =
        messageToString(
          entireConversation.find((message) => message.role === "user") ??
            lastMessage,
        ).slice(0, 50) + "...";

      const upsertChatFinalInput = {
        userId: session.user.id,
        chatId,
        messages: entireConversation,
        ...(isNewChat
          ? { title: generatedTitle || fallbackTitle }
          : {}),
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
    async consumeSseStream({ stream: sseStream }) {
      try {
        await streamContext.createNewResumableStream(streamId, () => sseStream);
      } catch (e) {
        console.error("Resumable stream failed:", e);
      }
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

  const resumedStream = await streamContext
    .resumeExistingStream(mostRecentStreamId)
    .catch((e) => {
      console.error("Resume stream failed:", e);
      return undefined;
    });

  if (resumedStream) {
    return new Response(resumedStream, {
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  }

  return new Response(null, { status: 204 });
}
