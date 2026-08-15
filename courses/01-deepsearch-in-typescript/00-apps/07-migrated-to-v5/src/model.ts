/**
 * Global model config for all 00-apps day projects.
 * Synced to each app's src/model.ts via: pnpm sync-env (from 00-apps/)
 *
 * Model ID comes from OPENROUTER_MODEL in shared/.env.shared.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const openrouter = createOpenRouter({
  apiKey: requireEnv("OPENROUTER_API_KEY"),
});

const languageModel = openrouter.chat(
  process.env.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free",
);

export const model = languageModel;
export const factualityModel = languageModel;
export const answerRelevancyModel = languageModel;
export const summarizationModel = languageModel;
export const guardrailModel = languageModel;
