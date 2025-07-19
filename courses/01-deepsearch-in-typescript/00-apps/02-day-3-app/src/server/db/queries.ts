import { db } from ".";
import { chats, messages } from "./schema";
import type { Message } from "ai";
import { eq, and } from "drizzle-orm";

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: Message[];
}) => {
  const { userId, chatId, title, messages: newMessages } = opts;

  // First, check if the chat exists and belongs to the user
  const existingChat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (existingChat) {
    // If chat exists but belongs to a different user, throw error
    if (existingChat.userId !== userId) {
      throw new Error("Chat ID not found.");
    }
    // Delete all existing messages
    await db.delete(messages).where(eq(messages.chatId, chatId));
  } else {
    // Create new chat
    await db.insert(chats).values({
      id: chatId,
      userId,
      title,
    });
  }

  // Insert all messages
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
    messages: chat.messages.map((msg) => ({
      id: msg.id,
      // msg.role is typed as string, so we
      // need to cast it to the correct type
      role: msg.role as "user" | "assistant",
      // msg.parts is typed as unknown[], so we
      // need to cast it to the correct type
      parts: msg.parts as Message["parts"],
      // content is not persisted, so we can
      // safely pass an empty string, because
      // parts are always present, and the AI SDK
      // will use the parts to construct the content
      content: "",
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
