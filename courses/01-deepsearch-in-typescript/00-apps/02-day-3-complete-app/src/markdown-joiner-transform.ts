import type { TextStreamPart, ToolSet } from "ai";

class MarkdownJoiner {
  private buffer = "";
  private isBuffering = false;

  processText(text: string): string {
    let output = "";

    for (const char of text) {
      if (!this.isBuffering) {
        if (char === "[" || char === "*") {
          this.buffer = char;
          this.isBuffering = true;
        } else {
          output += char;
        }
      } else {
        this.buffer += char;

        if (this.isCompleteLink() || this.isCompleteBold()) {
          output += this.buffer;
          this.clearBuffer();
        } else if (this.isFalsePositive(char)) {
          output += this.buffer;
          this.clearBuffer();
        }
      }
    }

    return output;
  }

  private isCompleteLink(): boolean {
    const linkPattern = /^\[.*?\]\(.*?\)$/;
    return linkPattern.test(this.buffer);
  }

  private isCompleteBold(): boolean {
    const boldPattern = /^\*\*.*?\*\*$/;
    return boldPattern.test(this.buffer);
  }

  private isFalsePositive(char: string): boolean {
    if (this.buffer.startsWith("[")) {
      return char === "\n" || (char === "[" && this.buffer.length > 1);
    }

    if (this.buffer.startsWith("*")) {
      if (this.buffer.length === 1 && /\s/.test(char)) {
        return true;
      }

      return char === "\n";
    }

    return false;
  }

  private clearBuffer(): void {
    this.buffer = "";
    this.isBuffering = false;
  }

  flush(): string {
    const remaining = this.buffer;
    this.clearBuffer();
    return remaining;
  }
}

export const markdownJoinerTransform =
  <TOOLS extends ToolSet>() =>
  () => {
    const joiner = new MarkdownJoiner();
    let lastTextDeltaId: string | undefined;

    return new TransformStream<
      TextStreamPart<TOOLS>,
      TextStreamPart<TOOLS>
    >({
      transform(chunk, controller) {
        if (!chunk) return;

        if (chunk.type === "text-delta") {
          if ("id" in chunk && chunk.id) {
            lastTextDeltaId = chunk.id;
          }
          const processedText = joiner.processText(chunk.text ?? "");
          if (processedText) {
            controller.enqueue({
              ...chunk,
              text: processedText,
            });
          }
          return;
        }

        controller.enqueue(chunk);
      },
      flush(controller) {
        const remaining = joiner.flush();
        if (remaining && lastTextDeltaId) {
          controller.enqueue({
            type: "text-delta",
            id: lastTextDeltaId,
            text: remaining,
          } as TextStreamPart<TOOLS>);
        }
      },
    });
  };
