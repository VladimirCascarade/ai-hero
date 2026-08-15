"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StickToBottom } from "use-stick-to-bottom";
import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import type { OurMessage } from "~/types";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  chatId: string;
  initialMessages: OurMessage[];
  isNewChat: boolean;
}

export const ChatPage = ({
  userName,
  isAuthenticated,
  chatId,
  initialMessages,
  isNewChat,
}: ChatProps) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const router = useRouter();

  const { messages, status, sendMessage } = useChat<OurMessage>({
    transport: new DefaultChatTransport({
      body: {
        chatId,
        isNewChat,
      },
    }),
    messages: initialMessages,
    onData: (dataPart) => {
      if (
        dataPart.type === "data-new-chat-created" &&
        typeof dataPart.data === "object" &&
        dataPart.data !== null &&
        "chatId" in dataPart.data &&
        typeof dataPart.data.chatId === "string"
      ) {
        router.push(`?id=${dataPart.data.chatId}`);
      }
    },
  });

  const prevStatusRef = useRef(status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (
      (prevStatus === "streaming" || prevStatus === "submitted") &&
      status === "ready"
    ) {
      router.refresh();
    }
  }, [status, router]);

  const [input, setInput] = useState("");
  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setShowSignInModal(true);
      return;
    }

    sendMessage({ text: input });
    setInput("");
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <StickToBottom
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-auto [&>div]:scrollbar-thin [&>div]:scrollbar-track-gray-200 [&>div]:scrollbar-thumb-gray-600"
          resize="instant"
          initial="instant"
        >
          <StickToBottom.Content>
            {messages.map((message, index) => {
              return (
                <ChatMessage
                  key={index}
                  parts={message.parts ?? []}
                  role={message.role}
                  userName={userName}
                />
              );
            })}
          </StickToBottom.Content>
        </StickToBottom>
        <div className="border-t border-gray-700">
          <form onSubmit={handleSubmit} className="mx-auto max-w-[65ch] p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
