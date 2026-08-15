import { db } from ".";
import { chats, messages } from "./schema";
import type { UIMessage } from "ai";
import { eq, and } from "drizzle-orm";

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title?: string;
  messages: UIMessage[];
}) => {
  const { userId, chatId, title, messages: newMessages } = opts;

  const existingChat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (existingChat) {
    if (existingChat.userId !== userId) {
      throw new Error("Chat ID not found.");
    }

    await db
      .update(chats)
      .set({
        ...(title !== undefined ? { title } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId));

    await db.delete(messages).where(eq(messages.chatId, chatId));
  } else {
    if (title === undefined) {
      throw new Error("Title is required when creating a new chat.");
    }

    await db.insert(chats).values({
      id: chatId,
      userId,
      title,
    });
  }

  await db.insert(messages).values(
    newMessages.map((message, index) => ({
      id: message.id ?? crypto.randomUUID(),
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
    messages: chat.messages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant",
      parts: msg.parts as UIMessage["parts"],
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
