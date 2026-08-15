import type { UIMessage } from "ai";

export const messageToString = (message: UIMessage) => {
  return message.parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      return "";
    })
    .join("");
};
