export type UsageTotals = {
  promptTokens?: number;
  completionTokens?: number;
};

export type ModelPricing = {
  inputCost?: number;
  outputCost?: number;
};

export function estimateCost(usage: UsageTotals, pricing: ModelPricing) {
  const input = usage.promptTokens ?? 0;
  const output = usage.completionTokens ?? 0;

  if (pricing.inputCost === undefined && pricing.outputCost === undefined) {
    return undefined;
  }

  return (input * (pricing.inputCost ?? 0) + output * (pricing.outputCost ?? 0)) / 1_000_000;
}
