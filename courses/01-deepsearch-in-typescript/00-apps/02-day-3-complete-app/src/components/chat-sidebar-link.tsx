"use client";

import Link from "next/link";
import { isGeneratingChatTitle } from "~/chat-title";
import { LoadingDots } from "./loading-dots";

interface ChatSidebarLinkProps {
  chatId: string;
  title: string;
  isActive: boolean;
}

export const ChatSidebarLink = ({
  chatId,
  title,
  isActive,
}: ChatSidebarLinkProps) => {
  return (
    <Link
      href={`/?id=${chatId}`}
      className={`flex-1 rounded-lg p-3 text-left text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
        isActive ? "bg-gray-700" : "hover:bg-gray-750 bg-gray-800"
      }`}
    >
      {isGeneratingChatTitle(title) ? <LoadingDots /> : title}
    </Link>
  );
};
