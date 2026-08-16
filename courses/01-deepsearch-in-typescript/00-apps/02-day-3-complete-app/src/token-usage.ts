import { env } from "~/env";

export const isSessionBudgetExceeded = (totalTokens: number) => {
  const budget = env.SESSION_TOKEN_BUDGET;
  return budget > 0 && totalTokens >= budget;
};

export const toUsageDataPart = (totalTokens: number) => ({
  totalTokens,
  ...(isSessionBudgetExceeded(totalTokens)
    ? { budgetExceeded: true as const }
    : {}),
});
