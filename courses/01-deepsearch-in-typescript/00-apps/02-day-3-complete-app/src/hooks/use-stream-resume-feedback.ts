import { useEffect, useRef, useState } from "react";

export function useStreamResumeFeedback(
  resumeEnabled: boolean,
  status: string,
  error: Error | undefined,
  clearError: () => void,
) {
  const [attemptDone, setAttemptDone] = useState(!resumeEnabled);
  const resumeFailed = useRef(false);

  useEffect(() => {
    if (attemptDone) return;

    if (status === "streaming") {
      setAttemptDone(true);
      return;
    }

    if (status === "ready" || status === "error") {
      resumeFailed.current = true;
      setAttemptDone(true);
      clearError();
    }
  }, [status, clearError, attemptDone]);

  useEffect(() => {
    if (resumeFailed.current && attemptDone && status === "submitted") {
      resumeFailed.current = false;
    }
  }, [status, attemptDone]);

  const isResuming = resumeEnabled && !attemptDone;
  const showError =
    Boolean(error) && !isResuming && !resumeFailed.current;

  return { isResuming, showError };
}
