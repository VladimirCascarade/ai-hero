import { tavily } from "@tavily/core";
import { env } from "~/env";
import { cacheWithRedis } from "~/server/redis/redis";

const tvly = tavily({
  apiKey: env.TAVILY_API_KEY,
});

export const searchTavily = cacheWithRedis(
  "tavily",
  async ({ query, num }: { query: string; num: number }) => {
    return tvly.search(query, { num });
  },
);
