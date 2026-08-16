import { Loader2 } from "lucide-react";

export const ResumeStreamMessage = () => (
  <div className="mx-auto w-full max-w-[65ch]">
    <div className="flex items-center gap-2 rounded-md bg-gray-800 p-3 text-sm text-gray-300">
      <Loader2 className="size-5 shrink-0 animate-spin" />
      Trying to resume stream on page reload...
    </div>
  </div>
);
