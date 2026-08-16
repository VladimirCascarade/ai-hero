"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StickToBottom } from "use-stick-to-bottom";
import { ChatMessage } from "~/components/chat-message";
import { ChatScrollArrows } from "~/components/chat-scroll-arrows";
import { ErrorMessage } from "~/components/error-message";
import { ResumeStreamMessage } from "~/components/resume-stream-message";
import { SignInModal } from "~/components/sign-in-modal";
import { TokenUsagePill } from "~/components/token-usage-pill";
import { useReloadStreamMessage } from "~/hooks/use-reload-stream-message";
import { useResumeOnMount } from "~/hooks/use-resume-on-mount";
import { useStreamResumeFeedback } from "~/hooks/use-stream-resume-feedback";
import type { OurMessage } from "~/types";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  chatId: string;
  initialMessages: OurMessage[];
  isNewChat: boolean;
  sessionTokenBudget: number;
}

export const ChatPage = ({
  userName,
  isAuthenticated,
  chatId,
  initialMessages,
  isNewChat,
  sessionTokenBudget,
}: ChatProps) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const router = useRouter();
  const resume = useResumeOnMount(isNewChat);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: {
          chatId,
          isNewChat,
        },
        prepareReconnectToStreamRequest: () => ({
          api: `/api/chat?chatId=${chatId}`,
        }),
      }),
    [chatId, isNewChat],
  );

  const { messages, status, sendMessage, error, clearError } = useChat<OurMessage>({
    id: chatId,
    resume,
    transport,
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

  const { attemptDone: resumeAttemptDone, showError } = useStreamResumeFeedback(
    resume,
    status,
    error,
    clearError,
  );
  const { showResumeMessage, hideDisconnectError } = useReloadStreamMessage(
    error,
    status,
    resume,
    resumeAttemptDone,
  );

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

  const latestUsage = useMemo(() => {
    const usagePart = messages
      .flatMap((message) =>
        message.role === "assistant" ? (message.parts ?? []) : [],
      )
      .findLast((part) => part.type === "data-usage");

    return usagePart?.type === "data-usage" ? usagePart.data : null;
  }, [messages]);

  const budgetExceeded = latestUsage?.budgetExceeded ?? false;
  const tokensUsed = latestUsage?.totalTokens ?? 0;
  const showTokenPill = sessionTokenBudget > 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setShowSignInModal(true);
      return;
    }

    if (budgetExceeded) {
      return;
    }

    sendMessage({ text: input });
    setInput("");
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <StickToBottom
          className="relative mx-auto w-full max-w-[65ch] flex-1 overflow-auto scrollbar-none [&>div]:scrollbar-none"
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
            {showResumeMessage && <ResumeStreamMessage />}
            {showError && !hideDisconnectError && error && (
              <ErrorMessage message={error.message} />
            )}
          </StickToBottom.Content>
          <ChatScrollArrows contentVersion={messages.length} />
        </StickToBottom>
        <div className="border-t border-gray-700">
          <div className="relative px-4 py-4">
            {showTokenPill && (
              <div className="absolute left-6 top-1/2 -translate-y-1/2">
                <TokenUsagePill
                  used={tokensUsed}
                  budget={sessionTokenBudget}
                  budgetExceeded={budgetExceeded}
                />
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="mx-auto flex w-full max-w-[65ch] items-center gap-2"
            >
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
                disabled={isLoading || budgetExceeded}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
