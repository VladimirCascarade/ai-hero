import { useEffect, useRef, useState } from "react";

function isStreamDisconnectError(error: Error) {
  return (
    error.message.includes("input stream") ||
    error.message.includes("Failed to fetch") ||
    error.name === "AbortError"
  );
}

export function useStreamResumeFeedback(
  resumeEnabled: boolean,
  status: string,
  error: Error | undefined,
  clearError: () => void,
) {
  const [attemptDone, setAttemptDone] = useState(!resumeEnabled);

  useEffect(() => {
    if (attemptDone) return;

    if (status === "streaming") {
      setAttemptDone(true);
      return;
    }

    if (status === "ready" || status === "error") {
      setAttemptDone(true);

      // Only clear spurious disconnect errors from the resume attempt itself.
      if (error && isStreamDisconnectError(error)) {
        clearError();
      }
    }
  }, [status, clearError, attemptDone, error]);

  const showError = Boolean(error) && attemptDone;

  return { attemptDone, showError };
}
