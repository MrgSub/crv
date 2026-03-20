import type { CatalogData } from "@/lib/catalog";

export type InitialModelSelection = {
  id: string;
  providerId: string;
  modelKey: string;
};

function findPreferredModel(catalog: CatalogData, modelKey: string) {
  return catalog.models.find(
    (entry) => entry.key === modelKey || entry.key.startsWith(`${modelKey}:`),
  );
}

function createSelectionId(modelKey: string, index: number) {
  return `selection-${index}-${modelKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

export function pickDefaultSelections(catalog: CatalogData): InitialModelSelection[] {
  const preferredModels = [
    "openai/gpt-4.1",
    "anthropic/claude-3.7-sonnet",
    "google/gemini-2.5-pro-preview",
    "meta-llama/llama-3.3-70b-instruct",
  ];
  const selections: InitialModelSelection[] = [];

  for (const modelKey of preferredModels) {
    const model = findPreferredModel(catalog, modelKey);
    if (!model) {
      continue;
    }

    selections.push({
      id: createSelectionId(model.key, selections.length),
      providerId: model.providerId,
      modelKey: model.key,
    });
  }

  if (selections.length === 0) {
    const fallbackProviders = ["openai", "anthropic", "google", "meta-llama"];

    for (const providerId of fallbackProviders) {
      const model = catalog.models.find((entry) => entry.providerId === providerId);
      if (!model) {
        continue;
      }

      selections.push({
        id: createSelectionId(model.key, selections.length),
        providerId,
        modelKey: model.key,
      });
    }
  }

  if (selections.length === 0 && catalog.models[0]) {
    selections.push({
      id: createSelectionId(catalog.models[0].key, 0),
      providerId: catalog.models[0].providerId,
      modelKey: catalog.models[0].key,
    });
  }

  return selections;
}
