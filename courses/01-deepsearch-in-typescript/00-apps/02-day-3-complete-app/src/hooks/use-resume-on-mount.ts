import { useRef } from "react";

/** Frozen at mount — prevents GET resume after new-chat URL redirect mid-POST. */
export function useResumeOnMount(isNewChat: boolean) {
  const shouldResume = useRef(!isNewChat);
  return shouldResume.current;
}
