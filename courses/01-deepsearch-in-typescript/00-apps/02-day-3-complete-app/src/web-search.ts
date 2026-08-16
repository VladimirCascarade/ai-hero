import { env } from "~/env";
import { searchSerper } from "~/serper";
import { searchTavily } from "~/tavily";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  scrapedContent: string;
  date: string;
};

export type WebSearchFn = (
  query: string,
  num: number,
) => Promise<WebSearchResult[]>;

type SearchProvider = "tavily" | "serper";

const searchWithTavily: WebSearchFn = async (query, num) => {
  const response = await searchTavily({ query, num });

  return response.results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
    scrapedContent: result.rawContent ?? result.content ?? "",
    date: new Date().toISOString(),
  }));
};

const searchWithSerper: WebSearchFn = async (query, num) => {
  const response = await searchSerper({ q: query, num }, undefined);

  return response.organic.map((result) => ({
    title: result.title,
    url: result.link,
    snippet: result.snippet,
    scrapedContent: "",
    date: result.date ?? new Date().toISOString(),
  }));
};

const providerSearchFns: Record<SearchProvider, WebSearchFn> = {
  tavily: searchWithTavily,
  serper: searchWithSerper,
};

const isProviderConfigured = (provider: SearchProvider): boolean => {
  if (provider === "tavily") {
    return !!env.TAVILY_API_KEY;
  }

  return !!env.SERPER_API_KEY;
};

const getProviderOrder = (): SearchProvider[] => {
  const preferred = env.SEARCH_PROVIDER;
  const fallback = preferred === "tavily" ? "serper" : "tavily";
  return [preferred, fallback];
};

export const getSearchFn = (): WebSearchFn => {
  const providers = getProviderOrder().filter(isProviderConfigured);

  if (providers.length === 0) {
    throw new Error(
      "No search provider available. Configure TAVILY_API_KEY and/or SERPER_API_KEY.",
    );
  }

  return async (query, num) => {
    const availableProviders = getProviderOrder().filter(isProviderConfigured);
    let lastError: unknown;

    for (const provider of availableProviders) {
      try {
        return await providerSearchFns[provider](query, num);
      } catch (error) {
        lastError = error;

        if (availableProviders.indexOf(provider) < availableProviders.length - 1) {
          console.warn(
            `[web-search] ${provider} failed, trying fallback...`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("All search providers failed");
  };
};
