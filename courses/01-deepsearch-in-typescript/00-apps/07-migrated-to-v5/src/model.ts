/**
 * Global model config for all 00-apps day projects.
 * Synced to each app's src/model.ts via: pnpm sync-env (from 00-apps/)
 *
 * Model IDs come from OPENROUTER_MODEL_HIGH / OPENROUTER_MODEL_FAST in shared/.env.shared.
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

export const model = openrouter.chat(
  process.env.OPENROUTER_MODEL_HIGH ?? "google/gemma-4-31b-it:free",
);

const fastModel = openrouter.chat(
  process.env.OPENROUTER_MODEL_FAST ?? "google/gemma-4-26b-a4b-it:free",
);

export const factualityModel = fastModel;
export const answerRelevancyModel = model;
export const summarizationModel = fastModel;
export const guardrailModel = fastModel;
export const chatTitleModel = fastModel;
