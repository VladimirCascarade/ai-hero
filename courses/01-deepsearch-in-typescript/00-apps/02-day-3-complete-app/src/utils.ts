import type { UIMessage } from "ai";
import type { z } from "zod";

export const messageToString = (message: UIMessage) => {
  return (message.parts ?? [])
    .map((part) => {
      if (part?.type === "text") {
        return part.text ?? "";
      }
      return "";
    })
    .join("");
};

/** Strip markdown fences and extract a JSON object string from model output. */
export const extractJsonObjectFromText = (text: string): string | null => {
  const trimmed = text.trim();

  const fencedMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
};

export const parseStructuredOutput = <T>(
  schema: z.ZodType<T>,
  text: string,
): T | null => {
  const jsonText = extractJsonObjectFromText(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = schema.safeParse(JSON.parse(jsonText));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
