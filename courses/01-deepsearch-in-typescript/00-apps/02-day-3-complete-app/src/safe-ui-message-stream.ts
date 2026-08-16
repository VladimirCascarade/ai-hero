/** Ensures text-delta chunks always have a preceding text-start (avoids SDK crash on abort). */
export const safeUIMessageStream = <T extends { type: string; id?: string }>(
  stream: ReadableStream<T>,
): ReadableStream<T> => {
  const activeTextIds = new Set<string>();

  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (chunk.type === "text-start" && chunk.id) {
          activeTextIds.add(chunk.id);
        }

        if (chunk.type === "text-delta" && chunk.id) {
          if (!activeTextIds.has(chunk.id)) {
            controller.enqueue({ type: "text-start", id: chunk.id } as T);
            activeTextIds.add(chunk.id);
          }
        }

        if (chunk.type === "text-end" && chunk.id) {
          activeTextIds.delete(chunk.id);
        }

        controller.enqueue(chunk);
      },
    }),
  );
};
