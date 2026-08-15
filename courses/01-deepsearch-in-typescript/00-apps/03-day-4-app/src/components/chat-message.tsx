import ReactMarkdown, { type Components } from "react-markdown";
import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";

type MessagePart = UIMessage["parts"][number];

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
}

const components: Components = {
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolPart = ({ part }: { part: MessagePart }) => {
  if (!isToolUIPart(part)) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-400">Tool:</span>
        <span className="text-sm text-gray-300">{part.type.replace("tool-", "")}</span>
      </div>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-400">State:</span>
        <span className="ml-2 text-sm text-gray-300">{part.state}</span>
      </div>
      {"input" in part && part.input != null && (
        <div className="mb-2">
          <span className="text-sm font-medium text-gray-400">Input:</span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-sm text-gray-300">
            {JSON.stringify(part.input, null, 2)}
          </pre>
        </div>
      )}
      {"output" in part && part.output != null && (
        <div>
          <span className="text-sm font-medium text-gray-400">Output:</span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-sm text-gray-300">
            {JSON.stringify(part.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            if (part.type === "text") {
              return <Markdown key={index}>{part.text}</Markdown>;
            }
            if (isToolUIPart(part)) {
              return <ToolPart key={index} part={part} />;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};
