import ReactMarkdown, { type Components } from "react-markdown";
import { useState } from "react";
import { SearchIcon } from "lucide-react";
import type { OurMessage, Source } from "~/types";

interface ChatMessageProps {
  parts: OurMessage["parts"];
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

const Sources = ({ sources }: { sources: Source[] }) => {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded border border-gray-700 bg-gray-800 p-3 text-left hover:bg-gray-700"
        >
          {source.favicon && (
            <img
              src={source.favicon}
              alt=""
              className="mt-0.5 size-4 shrink-0"
            />
          )}
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-200">
              {source.title}
            </div>
            <div className="mt-1 line-clamp-3 text-xs text-gray-400">
              {source.snippet}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
};

const getStepTitle = (part: OurMessage["parts"][number]) => {
  if (part.type === "data-research-plan") {
    return "Planning research";
  }

  if (part.type === "data-sources") {
    return "Sources";
  }

  if (part.type === "data-new-action") {
    return part.data.title;
  }

  return "";
};

const ReasoningSteps = ({ parts }: { parts: OurMessage["parts"] }) => {
  const [openStep, setOpenStep] = useState<number | null>(null);

  const steps = parts.filter(
    (part) =>
      part.type === "data-research-plan" ||
      part.type === "data-sources" ||
      part.type === "data-new-action",
  );

  if (steps.length === 0) return null;

  return (
    <div className="mb-4 w-full">
      <ul className="space-y-1">
        {steps.map((part, index) => {
          const isOpen = openStep === index;
          const title = getStepTitle(part);

          return (
            <li key={index} className="relative">
              <button
                onClick={() => setOpenStep(isOpen ? null : index)}
                className={`min-w-34 flex w-full flex-shrink-0 items-center rounded px-2 py-1 text-left text-sm transition-colors ${
                  isOpen
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"
                }`}
              >
                <span
                  className={`z-10 mr-3 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-500 text-xs font-bold ${
                    isOpen
                      ? "border-blue-400 text-white"
                      : "bg-gray-800 text-gray-300"
                  }`}
                >
                  {index + 1}
                </span>
                {title}
              </button>
              <div className={`${isOpen ? "mt-1" : "hidden"}`}>
                {isOpen && part.type === "data-research-plan" && (
                  <div className="px-2 py-1">
                    <div className="text-sm italic text-gray-400">
                      <Markdown>{part.data.plan}</Markdown>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {part.data.queries.map((query) => (
                        <li
                          key={query}
                          className="flex items-center gap-2 text-sm text-gray-400"
                        >
                          <SearchIcon className="size-4 shrink-0" />
                          <span>{query}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {isOpen && part.type === "data-sources" && (
                  <div className="px-2 py-1">
                    <Sources sources={part.data} />
                  </div>
                )}
                {isOpen && part.type === "data-new-action" && (
                  <div className="px-2 py-1">
                    <div className="text-sm italic text-gray-400">
                      <Markdown>{part.data.reasoning}</Markdown>
                    </div>
                    {part.data.type === "continue" && part.data.feedback && (
                      <div className="mt-2 text-sm text-gray-400">
                        <p className="font-medium text-gray-300">
                          Feedback for next iteration:
                        </p>
                        <Markdown>{part.data.feedback}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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

        {isAI && <ReasoningSteps parts={parts} />}

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            if (part?.type === "text" && part.text) {
              return <Markdown key={index}>{part.text}</Markdown>;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};
