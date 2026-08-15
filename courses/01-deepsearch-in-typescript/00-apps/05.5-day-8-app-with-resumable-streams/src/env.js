/**
 * Global env schema for AI-enabled day apps (02–07).
 * Synced to each app's src/env.js via: pnpm sync-env (from 00-apps/)
 *
 * 01-day-1-app keeps its own minimal env.js (no LLM).
 */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    REDIS_URL: z.string().url(),
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    AUTH_DISCORD_ID: z.string(),
    AUTH_DISCORD_SECRET: z.string(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_MODEL: z.string().default("google/gemma-4-31b-it:free"),
    SERPER_API_KEY: z.string(),
    LANGFUSE_SECRET_KEY: z.string(),
    LANGFUSE_PUBLIC_KEY: z.string(),
    LANGFUSE_BASEURL: z.string().url(),
    EVAL_DATASET: z
      .enum(["dev", "ci", "regression"])
      .default("dev")
      .optional(),
    SEARCH_RESULTS_COUNT: z.coerce.number().default(3),
    SCRAPE_URLS_COUNT: z.coerce.number().default(4),
  },
  client: {},
  runtimeEnv: {
    REDIS_URL: process.env.REDIS_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASEURL: process.env.LANGFUSE_BASEURL,
    EVAL_DATASET: process.env.EVAL_DATASET,
    SEARCH_RESULTS_COUNT: process.env.SEARCH_RESULTS_COUNT,
    SCRAPE_URLS_COUNT: process.env.SCRAPE_URLS_COUNT,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
