import { generateText, type LanguageModelUsage } from "ai";
import {
  langfuseTelemetry,
  type LangfuseTelemetryOpts,
} from "~/langfuse-telemetry";
import { summarizationModel } from "~/model";
import { redis } from "~/server/redis/redis";

const CACHE_EXPIRY_SECONDS = 60 * 60 * 6; // 6 hours

export type SummarizeURLInput = {
  conversation: string;
  scrapedContent: string;
  searchMetadata: {
    date: string;
    title: string;
    url: string;
  };
  query: string;
};

const buildPrompt = ({
  conversation,
  scrapedContent,
  searchMetadata,
  query,
}: SummarizeURLInput) => ({
  system: `You are a research extraction specialist. Given a research topic and raw web content, create a thoroughly detailed synthesis as a cohesive narrative that flows naturally between key concepts.

Extract the most valuable information related to the research topic, including relevant facts, statistics, methodologies, claims, and contextual information. Preserve technical terminology and domain-specific language from the source material.

Structure your synthesis as a coherent document with natural transitions between ideas. Begin with an introduction that captures the core thesis and purpose of the source material. Develop the narrative by weaving together key findings and their supporting details, ensuring each concept flows logically to the next.

Integrate specific metrics, dates, and quantitative information within their proper context. Explore how concepts interconnect within the source material, highlighting meaningful relationships between ideas. Acknowledge limitations by noting where information related to aspects of the research topic may be missing or incomplete.

Important guidelines:
- Maintain original data context (e.g., "2024 study of 150 patients" rather than generic "recent study")
- Preserve the integrity of information by keeping details anchored to their original context
- Create a cohesive narrative rather than disconnected bullet points or lists
- Use paragraph breaks only when transitioning between major themes

Critical Reminder: If content lacks a specific aspect of the research topic, clearly state that in the synthesis, and you should NEVER make up information and NEVER rely on external knowledge.`,
  prompt: `Create a synthesis of the raw web content below as it relates to the research topic.

---

Research Topic: ${query}

Source Title: ${searchMetadata.title}
Source URL: ${searchMetadata.url}
Source Date: ${searchMetadata.date}

Conversation History (for context):
${conversation}

Raw Web Content:
<content>
${scrapedContent}
</content>`,
});

export const summarizeURL = async (
  input: SummarizeURLInput,
  telemetry?: LangfuseTelemetryOpts,
): Promise<{ text: string; usage: LanguageModelUsage | null }> => {
  const key = `summarizeURL:${JSON.stringify([input])}`;
  const cachedResult = await redis.get(key);

  if (cachedResult) {
    console.log(`Cache hit for ${key}`);
    return {
      text: JSON.parse(cachedResult) as string,
      usage: null,
    };
  }

  const { text, usage } = await generateText({
    model: summarizationModel,
    ...buildPrompt(input),
    experimental_telemetry: langfuseTelemetry("summarize-url", {
      ...telemetry,
      metadata: {
        ...telemetry?.metadata,
        url: input.searchMetadata.url,
        query: input.query,
      },
    }),
  });

  await redis.set(key, JSON.stringify(text), "EX", CACHE_EXPIRY_SECONDS);
  return { text, usage };
};
