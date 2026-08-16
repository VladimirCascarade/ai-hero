import type { LanguageModelUsage, UIMessage } from "ai";
import { env } from "~/env";
import { isSessionBudgetExceeded } from "~/token-usage";
import { messageToString } from "~/utils";

export type TokenUsage = {
  descriptor: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

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
  /** The most recent feedback from getNextAction */
  private lastFeedback: string | null = null;
  private usages: TokenUsage[] = [];
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
    return this.getStopReason() !== null;
  }

  getStopReason(): "steps" | "budget" | null {
    if (isSessionBudgetExceeded(this.getTotalTokens())) {
      return "budget";
    }

    if (this.step >= env.MAX_AGENT_STEPS) {
      return "steps";
    }

    return null;
  }

  reportUsage(descriptor: string, usage: LanguageModelUsage) {
    this.usages.push({
      descriptor,
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    });
  }

  getUsages(): TokenUsage[] {
    return this.usages;
  }

  getTotalTokens(): number {
    return this.usages.reduce((sum, usage) => sum + (usage.totalTokens || 0), 0);
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

  /** User already replied after a clarification-only assistant turn — proceed to research. */
  shouldSkipClarification(): boolean {
    const lastAssistant = this.messages.findLast(
      (message) => message.role === "assistant",
    );
    const lastUser = this.messages.findLast((message) => message.role === "user");

    if (!lastAssistant || !lastUser) {
      return false;
    }

    const lastUserIdx = this.messages.lastIndexOf(lastUser);
    const lastAssistantIdx = this.messages.lastIndexOf(lastAssistant);

    if (lastUserIdx <= lastAssistantIdx) {
      return false;
    }

    const hadResearch = lastAssistant.parts?.some(
      (part) =>
        part.type === "data-research-plan" ||
        part.type === "data-sources" ||
        part.type === "data-new-action",
    );

    return !hadResearch;
  }
}
