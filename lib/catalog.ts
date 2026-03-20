const MODELS_API_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const HARDCODED_OPENROUTER_MODELS = {
  "meta-llama/llama-3.3-70b-instruct:free": "meta-llama/llama-3.3-70b-instruct",
} as const;

type ModelsApiResponse = Record<string, ProviderRecord>;

type ProviderRecord = {
  id: string;
  name: string;
  models?: Record<string, ModelRecord>;
};

type ModelRecord = {
  id: string;
  name?: string;
  family?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

export type ModelOption = {
  key: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  family?: string;
  contextWindow?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
};

export type ProviderOption = {
  id: string;
  name: string;
};

export type CatalogData = {
  providers: ProviderOption[];
  models: ModelOption[];
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function humanizeProvider(id: string) {
  return id
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripFreeSuffix(value: string) {
  return value.replace(/:free$/i, "").replace(/\s*\(free\)$/i, "");
}

function normalizeOpenRouterModelId(id: string) {
  return HARDCODED_OPENROUTER_MODELS[id as keyof typeof HARDCODED_OPENROUTER_MODELS] ?? id;
}

let cachedCatalog: CatalogData | null = null;
let cachedAt = 0;
let inflightCatalog: Promise<CatalogData> | null = null;

async function loadCatalog(): Promise<CatalogData> {
  const response = await fetch(MODELS_API_URL, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to load models catalog.");
  }

  const data = (await response.json()) as ModelsApiResponse;
  const openRouter = data.openrouter;

  if (!openRouter?.models) {
    throw new Error("OpenRouter catalog is unavailable.");
  }

  const providers = new Map<string, ProviderOption>();
  const models = Object.values(openRouter.models)
    .filter((model) => model.id)
    .map((model): ModelOption => {
      const normalizedId = normalizeOpenRouterModelId(model.id);
      const [providerId = "openrouter", ...rest] = normalizedId.split("/");
      const modelId = rest.length > 0 ? rest.join("/") : normalizedId;
      const providerName = data[providerId]?.name ?? humanizeProvider(providerId);
      providers.set(providerId, { id: providerId, name: providerName });

      return {
        key: normalizedId,
        providerId,
        providerName,
        modelId,
        label: stripFreeSuffix(model.name ?? model.id),
        family: model.family,
        contextWindow: model.limit?.context,
        inputCost: model.cost?.input,
        outputCost: model.cost?.output,
        cacheReadCost: model.cost?.cache_read,
      };
    })
    .sort((a, b) => {
      const providerOrder = compareText(a.providerName, b.providerName);
      if (providerOrder !== 0) {
        return providerOrder;
      }

      return compareText(a.label, b.label);
    });

  return {
    providers: Array.from(providers.values()).sort((a, b) => compareText(a.name, b.name)),
    models,
  };
}

export async function getCatalog(): Promise<CatalogData> {
  const now = Date.now();

  if (cachedCatalog && now - cachedAt < CATALOG_TTL_MS) {
    return cachedCatalog;
  }

  if (!inflightCatalog) {
    inflightCatalog = loadCatalog()
      .then((catalog) => {
        cachedCatalog = catalog;
        cachedAt = Date.now();
        return catalog;
      })
      .finally(() => {
        inflightCatalog = null;
      });
  }

  return inflightCatalog;
}
