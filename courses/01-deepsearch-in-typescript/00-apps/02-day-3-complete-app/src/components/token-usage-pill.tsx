import { Coins } from "lucide-react";

interface TokenUsagePillProps {
  used: number;
  budget: number;
  budgetExceeded?: boolean;
}

export const TokenUsagePill = ({
  used,
  budget,
  budgetExceeded = false,
}: TokenUsagePillProps) => {
  const remaining = Math.max(budget - used, 0);
  const showRemaining = budget > 0;

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
        budgetExceeded
          ? "border-red-500/40 bg-red-950/40"
          : "border-gray-600 bg-gray-800/80"
      }`}
      aria-label={
        showRemaining
          ? `${used.toLocaleString()} tokens used, ${remaining.toLocaleString()} remaining`
          : `${used.toLocaleString()} tokens used`
      }
    >
      <Coins className="size-4 shrink-0 text-amber-400/90" />
      <span className="text-red-400">{used.toLocaleString()}</span>
      <span className="font-normal text-gray-500">used</span>
      {showRemaining && (
        <>
          <span className="text-gray-600" aria-hidden="true">
            ·
          </span>
          <span className={budgetExceeded ? "text-red-300" : "text-emerald-400"}>
            {remaining.toLocaleString()}
          </span>
          <span className="font-normal text-gray-500">left</span>
        </>
      )}
    </div>
  );
};
