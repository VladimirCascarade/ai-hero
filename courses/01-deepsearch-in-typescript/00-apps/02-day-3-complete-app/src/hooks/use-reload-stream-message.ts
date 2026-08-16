import { useEffect, useRef, useState } from "react";

function isStreamDisconnectError(error: Error) {
  return (
    error.message.includes("input stream") ||
    error.message.includes("Failed to fetch") ||
    error.name === "AbortError"
  );
}

/** Reload/close mid-stream: show resume message instead of disconnect errors. */
export function useReloadStreamMessage(
  error: Error | undefined,
  status: string,
) {
  const [isUnloading, setIsUnloading] = useState(false);
  const wasStreaming = useRef(status === "streaming" || status === "submitted");

  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      wasStreaming.current = true;
    }
  }, [status]);

  useEffect(() => {
    const onPageHide = () => setIsUnloading(true);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const showResumeMessage =
    wasStreaming.current &&
    (isUnloading ||
      (Boolean(error) && isStreamDisconnectError(error)));

  return {
    showResumeMessage,
    hideDisconnectError: showResumeMessage,
  };
}
