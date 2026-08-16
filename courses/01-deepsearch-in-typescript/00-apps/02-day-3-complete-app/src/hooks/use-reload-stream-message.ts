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
  resumeEnabled: boolean,
  resumeAttemptDone: boolean,
) {
  const [isUnloading, setIsUnloading] = useState(false);
  const wasStreaming = useRef(false);

  useEffect(() => {
    // Ignore the automatic resume GET on mount — it sets status to "submitted"
    // even when there is no active stream to reconnect to.
    if (resumeEnabled && !resumeAttemptDone) {
      return;
    }

    if (status === "streaming" || status === "submitted") {
      wasStreaming.current = true;
    }
  }, [status, resumeEnabled, resumeAttemptDone]);

  useEffect(() => {
    const onPageHide = () => setIsUnloading(true);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const showResumeMessage =
    wasStreaming.current &&
    (isUnloading ||
      (error !== undefined && isStreamDisconnectError(error)));

  return {
    showResumeMessage,
    hideDisconnectError: showResumeMessage,
  };
}
