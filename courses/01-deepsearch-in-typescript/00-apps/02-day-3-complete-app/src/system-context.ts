import type { UIMessage } from "ai";
import { env } from "~/env";
import { messageToString } from "~/utils";

export type SearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
  summary: string;
};

export type SearchHistoryEntry = {
  query: string;
  results: SearchResult[];
};

const formatSearchResult = (result: SearchResult) =>
  [
    `### ${result.date} - ${result.title}`,
    result.url,
    result.snippet,
    `<summary>`,
    result.summary,
    `</summary>`,
  ].join("\n\n");

export class SystemContext {
  private step = 0;
  private searchHistory: SearchHistoryEntry[] = [];
  private lastFeedback: string | null = null;
  private readonly messages: UIMessage[];

  constructor(messages: UIMessage[]) {
    this.messages = messages;
  }

  getMessageHistory(): string {
    return this.messages
      .map((message) => {
        const role = message.role === "user" ? "User" : "Assistant";
        return `<${role}>${messageToString(message)}</${role}>`;
      })
      .join("\n\n");
  }

  shouldStop() {
    return this.step >= env.MAX_AGENT_STEPS;
  }

  incrementStep() {
    this.step++;
  }

  reportSearch(search: SearchHistoryEntry) {
    this.searchHistory.push(search);
  }

  setLastFeedback(feedback: string) {
    this.lastFeedback = feedback;
  }

  getLastFeedback(): string | null {
    return this.lastFeedback;
  }

  getSearchHistory(): string {
    return this.searchHistory
      .map((search) =>
        [
          `## Query: "${search.query}"`,
          ...search.results.map(formatSearchResult),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  hasResearch(): boolean {
    return this.searchHistory.length > 0;
  }

  getLatestUserMessage(): string {
    const message = this.messages.findLast((message) => message.role === "user");

    if (!message) {
      throw new Error("No user message found");
    }

    return messageToString(message);
  }

  isFollowUp(): boolean {
    return this.messages.some((message) => message.role === "assistant");
  }
}
