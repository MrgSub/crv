import { createOpenRouter, type OpenRouterUsageAccounting } from "@openrouter/ai-sdk-provider";

export function createOpenRouterClient({
  apiKey,
  referer,
  title,
}: {
  apiKey: string;
  referer: string;
  title: string;
}) {
  return createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": referer,
      "X-OpenRouter-Title": title,
    },
  });
}

export function getOpenRouterUsage(metadata: unknown) {
  const usage = (metadata as { openrouter?: { usage?: OpenRouterUsageAccounting } } | undefined)
    ?.openrouter?.usage;

  return usage;
}
