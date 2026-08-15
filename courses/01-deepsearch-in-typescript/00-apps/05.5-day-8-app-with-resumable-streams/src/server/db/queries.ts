import { db } from "./index.ts";
import { chats, messages, streams } from "./schema.ts";
import type { UIMessage } from "ai";
import { eq, and } from "drizzle-orm";

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: UIMessage[];
}) => {
  const { userId, chatId, title, messages: newMessages } = opts;

  const existingChat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (existingChat) {
    if (existingChat.userId !== userId) {
      throw new Error("Chat ID already exists under a different user");
    }
    await db.delete(messages).where(eq(messages.chatId, chatId));
  } else {
    await db.insert(chats).values({
      id: chatId,
      userId,
      title,
    });
  }

  await db.insert(messages).values(
    newMessages.map((message, index) => ({
      id: crypto.randomUUID(),
      chatId,
      role: message.role,
      parts: message.parts,
      order: index,
    })),
  );

  return { id: chatId };
};

export const getChat = async (opts: { userId: string; chatId: string }) => {
  const { userId, chatId } = opts;

  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    with: {
      messages: {
        orderBy: (messages, { asc }) => [asc(messages.order)],
      },
    },
  });

  if (!chat) {
    return null;
  }

  return {
    ...chat,
    messages: chat.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
    })),
  };
};

export const getChats = async (opts: { userId: string }) => {
  const { userId } = opts;

  return await db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: (chats, { desc }) => [desc(chats.updatedAt)],
  });
};

export const appendStreamId = async (opts: {
  chatId: string;
  streamId: string;
}): Promise<void> => {
  const { chatId, streamId } = opts;

  await db.insert(streams).values({
    id: streamId,
    chatId,
  });
};

export const getStreamIds = async (opts: {
  chatId: string;
}): Promise<{
  streamIds: string[];
  mostRecentStreamId: string | undefined;
}> => {
  const { chatId } = opts;

  const streamResult = await db.query.streams.findMany({
    where: eq(streams.chatId, chatId),
    orderBy: (streams, { desc }) => [desc(streams.createdAt)],
  });

  return {
    streamIds: streamResult.map((stream) => stream.id),
    mostRecentStreamId: streamResult[0]?.id,
  };
};
