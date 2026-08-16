import { tavily } from "@tavily/core";
import type { TavilyClient } from "@tavily/core";
import { env } from "~/env";
import { cacheWithRedis } from "~/server/redis/redis";

let tvly: TavilyClient | undefined;

const getTavilyClient = () => {
  if (!env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  tvly ??= tavily({
    apiKey: env.TAVILY_API_KEY,
  });

  return tvly;
};

export const searchTavily = cacheWithRedis(
  "tavily",
  async ({ query, num }: { query: string; num: number }) => {
    return getTavilyClient().search(query, { num });
  },
);
