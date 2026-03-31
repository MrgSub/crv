import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateText, jsonSchema, tool, stepCountIs } from "ai";

import { getCatalog } from "./catalog";
import { createOpenRouterClient, getOpenRouterUsage } from "./openrouter";
import { estimateCost } from "./pricing";
import { parseJsonSchemaText, validateJsonResponse } from "./schema-validation";

type McpServerOptions = {
  resolveApiKey?: () => string;
  referer?: string;
  title?: string;
};

type ToolCallRecord = {
  name: string;
  input: unknown;
  output: unknown;
};

type ModelResult = {
  modelKey: string;
  response: string;
  toolCalls: ToolCallRecord[];
  durationMs: number;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  estimatedCost: number | undefined;
  finishReason: string;
};

type ModelError = {
  modelKey: string;
  error: string;
  durationMs: number;
};

type EvalOutcome = ModelResult | ModelError;

function isModelError(r: EvalOutcome): r is ModelError {
  return "error" in r;
}

type ToolDef = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

function buildToolSet(
  toolDefs: ToolDef[] | undefined,
  toolMocks: Record<string, unknown> | undefined,
) {
  if (!toolDefs?.length) return undefined;

  const toolSet: Record<string, ReturnType<typeof tool<any, any>>> = {};
  for (const def of toolDefs) {
    const mock = toolMocks?.[def.name];
    const schema = jsonSchema(
      def.inputSchema as import("json-schema").JSONSchema7,
    );
    if (mock !== undefined) {
      toolSet[def.name] = tool({
        description: def.description,
        inputSchema: schema,
        execute: async () => mock,
      });
    } else {
      toolSet[def.name] = tool({
        description: def.description,
        inputSchema: schema,
      });
    }
  }
  return toolSet;
}

type ProviderRouting = {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: string;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: string;
};

async function runModel(args: {
  modelKey: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  openrouter: ReturnType<typeof createOpenRouterClient>;
  pricing?: { inputCost?: number; outputCost?: number };
  timeoutMs?: number;
  tools?: ToolDef[];
  toolMocks?: Record<string, unknown>;
  maxTurns?: number;
  providerRouting?: ProviderRouting;
}): Promise<ModelResult> {
  const {
    modelKey,
    messages,
    openrouter,
    pricing,
    timeoutMs,
    tools: toolDefs,
    toolMocks,
    maxTurns,
    providerRouting,
  } = args;
  const startedAt = Date.now();
  const abortSignal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const toolSet = buildToolSet(toolDefs, toolMocks);

  const modelSettings: Record<string, unknown> = {};
  if (providerRouting) modelSettings.provider = providerRouting;

  const { text, usage, providerMetadata, finishReason, steps } =
    await generateText({
      model: openrouter(modelKey, modelSettings),
      messages,
      abortSignal,
      ...(toolSet ? { tools: toolSet } : {}),
      ...(toolSet && maxTurns ? { stopWhen: stepCountIs(maxTurns) } : {}),
    });

  const allToolCalls: ToolCallRecord[] = steps.flatMap((step) =>
    (step.toolCalls ?? []).map((tc) => ({
      name: tc.toolName,
      input: tc.input,
      output: (step.toolResults ?? []).find(
        (tr) => "toolCallId" in tr && tr.toolCallId === tc.toolCallId,
      )?.output,
    })),
  );

  const orUsage = getOpenRouterUsage(providerMetadata);
  const promptTokens = orUsage?.promptTokens ?? usage.inputTokens;
  const completionTokens = orUsage?.completionTokens ?? usage.outputTokens;
  const estimated = estimateCost(
    { promptTokens, completionTokens },
    { inputCost: pricing?.inputCost, outputCost: pricing?.outputCost },
  );

  return {
    modelKey,
    response: text,
    toolCalls: allToolCalls,
    durationMs: Date.now() - startedAt,
    promptTokens,
    completionTokens,
    estimatedCost: estimated,
    finishReason: finishReason ?? "unknown",
  };
}

async function runModelSafe(
  args: Parameters<typeof runModel>[0],
): Promise<EvalOutcome> {
  try {
    return await runModel(args);
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    return {
      modelKey: args.modelKey,
      error:
        isTimeout ? `Timed out after ${(args.timeoutMs ?? 0) / 1000}s`
        : err instanceof Error ? err.message
        : "Request failed",
      durationMs: 0,
    };
  }
}

const MAX_CONCURRENT = 50;

async function runModelsWithConcurrency(
  tasks: Array<Parameters<typeof runModel>[0]>,
): Promise<EvalOutcome[]> {
  const results: EvalOutcome[] = new Array(tasks.length);
  let idx = 0;
  let active = 0;

  await new Promise<void>((resolve) => {
    function next() {
      if (idx >= tasks.length && active === 0) {
        resolve();
        return;
      }
      while (active < MAX_CONCURRENT && idx < tasks.length) {
        const i = idx++;
        active++;
        runModelSafe(tasks[i]).then((r) => {
          results[i] = r;
          active--;
          next();
        });
      }
    }
    next();
  });

  return results;
}

function buildMessages(
  systemPrompt: string | undefined,
  prompt: string,
): Array<{ role: "system" | "user"; content: string }> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function parseSchemaParam(schemaText: string | undefined) {
  if (!schemaText?.trim()) return { ok: true as const, validator: null };
  const parsed = parseJsonSchemaText(schemaText);
  if (!parsed.ok) return parsed;
  return { ok: true as const, validator: parsed.validator };
}

function getByPath(obj: unknown, path: string): unknown {
  const segmentRe = /([^.[]+)|\[(\d+)\]/g;
  let current: unknown = obj;
  let match: RegExpExecArray | null;
  while ((match = segmentRe.exec(path)) !== null) {
    if (current === null || current === undefined) return undefined;
    const key = match[1] ?? match[2];
    if (Array.isArray(current) && match[2] !== undefined) {
      current = current[Number(key)];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function attachValidation(
  result: EvalOutcome,
  validator: import("zod").ZodTypeAny | null,
) {
  if (isModelError(result)) return result;
  const out: Record<string, unknown> = { ...result };
  if (result.toolCalls.length > 0) out.toolCalls = result.toolCalls;
  if (validator)
    out.validation = validateJsonResponse(result.response, validator);
  return out;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const resolveApiKey = options.resolveApiKey;
  if (!resolveApiKey) {
    throw new Error(
      "createMcpServer requires a request-scoped OpenRouter API key resolver.",
    );
  }
  const referer = options.referer ?? "https://crv.sh";
  const title = options.title ?? "crv.sh";
  const createProvider = (providerTitle = title) =>
    createOpenRouterClient({
      apiKey: resolveApiKey(),
      referer,
      title: providerTitle,
    });

  const server = new McpServer({
    name: "crv",
    version: "1.0.0",
  });

  // ── list_models ──────────────────────────────────────────────
  server.tool(
    "list_models",
    "List available OpenRouter models with pricing and context window info. Optionally filter by provider or search term.",
    {
      search: z.string().optional().describe("Filter models by name or key"),
      provider: z
        .string()
        .optional()
        .describe("Filter by provider ID (e.g. 'openai', 'anthropic')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max number of models to return (default 50)"),
    },
    async ({ search, provider, limit }) => {
      const catalog = await getCatalog();
      let models = catalog.models;

      if (provider) {
        models = models.filter(
          (m) => m.providerId.toLowerCase() === provider.toLowerCase(),
        );
      }

      if (search) {
        const q = search.toLowerCase();
        models = models.filter(
          (m) =>
            m.key.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q),
        );
      }

      const sliced = models.slice(0, limit ?? 50);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalMatched: models.length,
                returned: sliced.length,
                models: sliced.map((m) => ({
                  key: m.key,
                  label: m.label,
                  provider: m.providerName,
                  contextWindow: m.contextWindow,
                  inputCostPer1M: m.inputCost,
                  outputCostPer1M: m.outputCost,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Shared tool param schemas ─────────────────────────────────
  const toolDefSchema = z.object({
    name: z.string().describe("Tool name the model can call"),
    description: z
      .string()
      .optional()
      .describe("Description shown to the model"),
    inputSchema: z
      .record(z.string(), z.unknown())
      .describe("JSON Schema for the tool's input parameters"),
  });

  const toolsParam = z
    .array(toolDefSchema)
    .optional()
    .describe(
      "JSON Schema tool definitions to pass to the model's tools field. Models will use native function calling instead of faking JSON.",
    );

  const toolMocksParam = z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Map of tool name → canned response. When the model calls a tool, the mock is returned as the result, enabling multi-turn flows.",
    );

  const maxTurnsParam = z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Maximum number of model steps (send → collect tool calls → inject mocks → re-send). Requires tools and toolMocks.",
    );

  const providerRoutingParam = z
    .object({
      order: z
        .array(z.string())
        .optional()
        .describe(
          'List of provider slugs to try in order (e.g. ["anthropic", "openai"])',
        ),
      allow_fallbacks: z
        .boolean()
        .optional()
        .describe(
          "Whether to allow backup providers when primary is unavailable (default: true)",
        ),
      require_parameters: z
        .boolean()
        .optional()
        .describe(
          "Only use providers that support all parameters in your request (default: false)",
        ),
      data_collection: z
        .string()
        .optional()
        .describe(
          "Control whether to use providers that may store data ('allow' or 'deny')",
        ),
      only: z
        .array(z.string())
        .optional()
        .describe("List of provider slugs to allow for this request"),
      ignore: z
        .array(z.string())
        .optional()
        .describe("List of provider slugs to skip for this request"),
      quantizations: z
        .array(z.string())
        .optional()
        .describe(
          'List of quantization levels to filter by (e.g. ["int4", "int8"])',
        ),
      sort: z
        .string()
        .optional()
        .describe("Sort providers by 'price', 'throughput', or 'latency'"),
    })
    .optional()
    .describe(
      "OpenRouter provider routing preferences to control which providers serve the request (order, only, ignore, sort, etc.)",
    );

  // ── eval_prompt ──────────────────────────────────────────────
  server.tool(
    "eval_prompt",
    "Run a prompt against one or more LLM models via OpenRouter. Returns each model's response with latency, token usage, and estimated cost.",
    {
      prompt: z.string().min(1).describe("The user prompt to send"),
      systemPrompt: z.string().optional().describe("Optional system prompt"),
      models: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe(
          "Array of model keys to evaluate (e.g. ['openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514'])",
        ),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(300_000)
        .optional()
        .describe("Timeout per model in milliseconds"),
      schemaText: z
        .string()
        .max(20_000)
        .optional()
        .describe(
          "JSON schema to validate each model response against. Uses the eval studio schema format.",
        ),
      tools: toolsParam,
      toolMocks: toolMocksParam,
      maxTurns: maxTurnsParam,
      providerRouting: providerRoutingParam,
    },
    async ({
      prompt,
      systemPrompt,
      models: modelKeys,
      timeoutMs,
      schemaText,
      tools: toolDefs,
      toolMocks,
      maxTurns,
      providerRouting,
    }) => {
      const catalog = await getCatalog();
      const catalogByKey = new Map(catalog.models.map((m) => [m.key, m]));

      const schema = parseSchemaParam(schemaText);
      if (!schema.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Schema parse error: ${schema.error}`,
            },
          ],
          isError: true,
        };
      }

      const openrouter = createProvider();

      const messages = buildMessages(systemPrompt, prompt);
      const tasks = modelKeys.map((modelKey) => ({
        modelKey,
        messages,
        openrouter,
        pricing: {
          inputCost: catalogByKey.get(modelKey)?.inputCost,
          outputCost: catalogByKey.get(modelKey)?.outputCost,
        },
        timeoutMs,
        tools: toolDefs,
        toolMocks,
        maxTurns,
        providerRouting,
      }));

      const results = await runModelsWithConcurrency(tasks);
      const output = results.map((r) => attachValidation(r, schema.validator));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    },
  );

  // ── eval_batch ──────────────────────────────────────────────
  server.tool(
    "eval_batch",
    "Run one prompt against ALL available models (or a filtered subset) in a single call. No manual chunking needed — handles hundreds of models with built-in concurrency. Optionally validates each response against a JSON schema.",
    {
      prompt: z.string().min(1).describe("The user prompt to send"),
      systemPrompt: z.string().optional().describe("Optional system prompt"),
      filter: z
        .string()
        .optional()
        .describe(
          "Optional filter to narrow models by provider or name (e.g. 'openai', 'claude', 'llama'). If omitted, runs against ALL models.",
        ),
      schemaText: z
        .string()
        .max(20_000)
        .optional()
        .describe("JSON schema to validate each model response against"),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(300_000)
        .optional()
        .describe("Timeout per model in milliseconds (default: no timeout)"),
      tools: toolsParam,
      toolMocks: toolMocksParam,
      maxTurns: maxTurnsParam,
      providerRouting: providerRoutingParam,
    },
    async ({
      prompt,
      systemPrompt,
      filter,
      schemaText,
      timeoutMs,
      tools: toolDefs,
      toolMocks,
      maxTurns,
      providerRouting,
    }) => {
      const catalog = await getCatalog();

      let models = catalog.models;
      if (filter) {
        const q = filter.toLowerCase();
        models = models.filter(
          (m) =>
            m.key.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            m.providerId.toLowerCase().includes(q),
        );
      }

      const schema = parseSchemaParam(schemaText);
      if (!schema.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Schema parse error: ${schema.error}`,
            },
          ],
          isError: true,
        };
      }

      const openrouter = createProvider();

      const messages = buildMessages(systemPrompt, prompt);
      const tasks = models.map((m) => ({
        modelKey: m.key,
        messages,
        openrouter,
        pricing: { inputCost: m.inputCost, outputCost: m.outputCost },
        timeoutMs,
        tools: toolDefs,
        toolMocks,
        maxTurns,
        providerRouting,
      }));

      const results = await runModelsWithConcurrency(tasks);
      const output = results.map((r) => attachValidation(r, schema.validator));

      const summary = {
        totalModels: models.length,
        succeeded: output.filter((r) => !("error" in r)).length,
        failed: output.filter((r) => "error" in r).length,
        ...(schema.validator ?
          {
            schemaValid: output.filter(
              (r) =>
                "validation" in r &&
                (r as Record<string, unknown>).validation &&
                (
                  (r as Record<string, unknown>).validation as {
                    status: string;
                  }
                ).status === "passed",
            ).length,
          }
        : {}),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ summary, results: output }, null, 2),
          },
        ],
      };
    },
  );

  // ── eval_suite ──────────────────────────────────────────────
  server.tool(
    "eval_suite",
    "Run multiple test cases against a list of models in one call. Returns a pass/fail matrix. Assertions can check JSON paths for equality, null/non-null, type, and regex patterns.",
    {
      models: z.array(z.string()).min(1).describe("Model keys to evaluate"),
      systemPrompt: z
        .string()
        .optional()
        .describe("Optional system prompt shared across all test cases"),
      testCases: z
        .array(
          z.object({
            name: z.string().describe("Test case name"),
            prompt: z.string().min(1).describe("The prompt for this test case"),
            assertions: z
              .array(
                z.object({
                  path: z
                    .string()
                    .describe(
                      "Dot-notation JSON path (e.g. 'draft', 'meta.status')",
                    ),
                  equals: z
                    .unknown()
                    .optional()
                    .describe("Expected exact value"),
                  isNull: z
                    .boolean()
                    .optional()
                    .describe("Assert the value is null"),
                  isNotNull: z
                    .boolean()
                    .optional()
                    .describe("Assert the value is not null"),
                  type: z
                    .enum(["string", "number", "boolean", "object", "array"])
                    .optional()
                    .describe("Assert the value is of this type"),
                  matches: z
                    .string()
                    .optional()
                    .describe("Regex pattern the value must match"),
                }),
              )
              .optional()
              .describe("Assertions to check against the parsed JSON response"),
            schemaText: z
              .string()
              .max(20_000)
              .optional()
              .describe(
                "Optional JSON schema to validate this test case's response",
              ),
          }),
        )
        .min(1)
        .max(100)
        .describe("Test cases to run"),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(300_000)
        .optional()
        .describe("Timeout per model call in milliseconds"),
      tools: toolsParam,
      toolMocks: toolMocksParam,
      maxTurns: maxTurnsParam,
      providerRouting: providerRoutingParam,
    },
    async ({
      models: modelKeys,
      systemPrompt,
      testCases,
      timeoutMs,
      tools: toolDefs,
      toolMocks,
      maxTurns,
      providerRouting,
    }) => {
      const catalog = await getCatalog();
      const catalogByKey = new Map(catalog.models.map((m) => [m.key, m]));

      const openrouter = createProvider();

      const matrix: Record<string, Record<string, unknown>> = {};

      for (const tc of testCases) {
        const messages = buildMessages(systemPrompt, tc.prompt);
        const schema = parseSchemaParam(tc.schemaText);

        const tasks = modelKeys.map((modelKey) => ({
          modelKey,
          messages,
          openrouter,
          pricing: {
            inputCost: catalogByKey.get(modelKey)?.inputCost,
            outputCost: catalogByKey.get(modelKey)?.outputCost,
          },
          timeoutMs,
          tools: toolDefs,
          toolMocks,
          maxTurns,
          providerRouting,
        }));

        const results = await runModelsWithConcurrency(tasks);

        for (const result of results) {
          const modelEntry: Record<string, unknown> = {};

          if (isModelError(result)) {
            modelEntry.pass = false;
            modelEntry.error = result.error;
          } else {
            modelEntry.response = result.response;
            modelEntry.durationMs = result.durationMs;
            modelEntry.estimatedCost = result.estimatedCost;
            if (result.toolCalls.length > 0)
              modelEntry.toolCalls = result.toolCalls;

            // Schema validation
            if (schema.ok && schema.validator) {
              const v = validateJsonResponse(result.response, schema.validator);
              modelEntry.schemaValidation = v;
            }

            // Assertion checks
            if (tc.assertions?.length) {
              // Build assertion root: response JSON + allToolCalls
              let parsed: unknown = undefined;
              try {
                const candidate = result.response.trim();
                const stripped =
                  candidate.startsWith("```") && candidate.endsWith("```") ?
                    candidate.split("\n").slice(1, -1).join("\n").trim()
                  : candidate;
                parsed = JSON.parse(stripped);
              } catch {
                // not valid JSON — parsed stays undefined
              }

              const assertionRoot: Record<string, unknown> = {
                ...(typeof parsed === "object" && parsed !== null ?
                  (parsed as Record<string, unknown>)
                : {}),
                allToolCalls: result.toolCalls,
              };

              const assertionResults = tc.assertions.map((a) => {
                const value = getByPath(assertionRoot, a.path);

                // For non-toolCall paths, require valid JSON
                if (
                  !a.path.startsWith("allToolCalls") &&
                  parsed === undefined
                ) {
                  return {
                    path: a.path,
                    pass: false,
                    reason: "Response is not valid JSON",
                  };
                }

                if (a.equals !== undefined) {
                  const pass =
                    JSON.stringify(value) === JSON.stringify(a.equals);
                  return {
                    path: a.path,
                    pass,
                    expected: a.equals,
                    actual: value,
                  };
                }
                if (a.isNull) {
                  const pass = value === null || value === undefined;
                  return {
                    path: a.path,
                    pass,
                    reason:
                      pass ? "is null" : `expected null, got ${typeof value}`,
                  };
                }
                if (a.isNotNull) {
                  const pass = value !== null && value !== undefined;
                  return {
                    path: a.path,
                    pass,
                    reason:
                      pass ? "is not null" : (
                        "expected non-null, got null/undefined"
                      ),
                  };
                }
                if (a.type) {
                  const actual = Array.isArray(value) ? "array" : typeof value;
                  const pass = actual === a.type;
                  return { path: a.path, pass, expected: a.type, actual };
                }
                if (a.matches) {
                  const str =
                    typeof value === "string" ? value : JSON.stringify(value);
                  const pass = new RegExp(a.matches).test(str ?? "");
                  return { path: a.path, pass, pattern: a.matches };
                }
                return {
                  path: a.path,
                  pass: true,
                  reason: "no assertion specified",
                };
              });

              modelEntry.assertions = assertionResults;
              modelEntry.pass = assertionResults.every((a) => a.pass);
            } else {
              modelEntry.pass = true;
            }
          }

          if (!matrix[tc.name]) matrix[tc.name] = {};
          matrix[tc.name][result.modelKey] = modelEntry;
        }
      }

      // Build summary
      const summary: Record<
        string,
        { passed: number; failed: number; errors: number }
      > = {};
      for (const modelKey of modelKeys) {
        let passed = 0,
          failed = 0,
          errors = 0;
        for (const tc of testCases) {
          const entry = matrix[tc.name]?.[modelKey] as
            | Record<string, unknown>
            | undefined;
          if (!entry) {
            errors++;
            continue;
          }
          if (entry.error) errors++;
          else if (entry.pass) passed++;
          else failed++;
        }
        summary[modelKey] = { passed, failed, errors };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ summary, matrix }, null, 2),
          },
        ],
      };
    },
  );

  // ── eval_rank ───────────────────────────────────────────────
  server.tool(
    "eval_rank",
    "Given results from eval_batch or eval_suite, return a ranked leaderboard sorted by a composite score (schema compliance rate, assertion pass rate, latency, and cost). Pass the raw results JSON from a previous eval call.",
    {
      results: z
        .string()
        .min(1)
        .describe(
          "The raw JSON string from an eval_batch or eval_suite result. Can be the full response or just the results array.",
        ),
    },
    async ({ results: resultsJson }) => {
      let data: unknown;
      try {
        data = JSON.parse(resultsJson);
      } catch {
        return {
          content: [
            { type: "text" as const, text: "Error: Invalid JSON input" },
          ],
          isError: true,
        };
      }

      // Handle eval_batch format: { summary, results: [...] }
      // Handle eval_suite format: { summary: { model: {passed,failed,errors} }, matrix: {...} }
      // Handle raw array of results

      type RankedModel = {
        modelKey: string;
        schemaPassRate: number;
        assertionPassRate: number;
        avgDurationMs: number;
        totalCost: number;
        score: number;
        errors: number;
      };

      const rankings: RankedModel[] = [];

      // Detect format
      const obj = data as Record<string, unknown>;
      if (Array.isArray(data) || (obj.results && Array.isArray(obj.results))) {
        // eval_batch or eval_prompt format
        const items = (Array.isArray(data) ? data : obj.results) as Record<
          string,
          unknown
        >[];

        for (const item of items) {
          if (!item.modelKey) continue;
          const modelKey = item.modelKey as string;
          const hasError = !!item.error;
          const validation = item.validation as { status?: string } | undefined;
          const schemaPass =
            validation?.status === "passed" ? 1
            : validation ? 0
            : 1;
          const durationMs = (item.durationMs as number) || 0;
          const cost = (item.estimatedCost as number) || 0;

          rankings.push({
            modelKey,
            schemaPassRate: schemaPass,
            assertionPassRate: hasError ? 0 : 1,
            avgDurationMs: durationMs,
            totalCost: cost,
            score: 0,
            errors: hasError ? 1 : 0,
          });
        }
      } else if (obj.summary && obj.matrix) {
        // eval_suite format
        const suiteMatrix = obj.matrix as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        const suiteSummary = obj.summary as Record<
          string,
          { passed: number; failed: number; errors: number }
        >;

        for (const [modelKey, stats] of Object.entries(suiteSummary)) {
          const total = stats.passed + stats.failed + stats.errors;
          let totalDuration = 0;
          let totalCost = 0;
          let schemaPassCount = 0;
          let schemaTotal = 0;
          let count = 0;

          for (const testCase of Object.values(suiteMatrix)) {
            const entry = testCase[modelKey];
            if (!entry) continue;
            count++;
            totalDuration += (entry.durationMs as number) || 0;
            totalCost += (entry.estimatedCost as number) || 0;
            const sv = entry.schemaValidation as
              | { status?: string }
              | undefined;
            if (sv) {
              schemaTotal++;
              if (sv.status === "passed") schemaPassCount++;
            }
          }

          rankings.push({
            modelKey,
            schemaPassRate: schemaTotal > 0 ? schemaPassCount / schemaTotal : 1,
            assertionPassRate: total > 0 ? stats.passed / total : 0,
            avgDurationMs: count > 0 ? totalDuration / count : 0,
            totalCost,
            score: 0,
            errors: stats.errors,
          });
        }
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Unrecognized results format. Pass the JSON output from eval_batch, eval_suite, or eval_prompt.",
            },
          ],
          isError: true,
        };
      }

      // Compute composite score:
      // score = (schemaPassRate * assertionPassRate) / (normalizedLatency * normalizedCost)
      // Higher is better. Normalize latency and cost to avoid division by zero.
      const maxDuration = Math.max(...rankings.map((r) => r.avgDurationMs), 1);
      const maxCost = Math.max(...rankings.map((r) => r.totalCost), 0.000001);

      for (const r of rankings) {
        const quality = r.schemaPassRate * r.assertionPassRate;
        const latencyFactor = Math.max(r.avgDurationMs / maxDuration, 0.01);
        const costFactor = Math.max(r.totalCost / maxCost, 0.01);
        r.score = quality / (latencyFactor * costFactor);
      }

      rankings.sort((a, b) => b.score - a.score);

      const leaderboard = rankings.map((r, i) => ({
        rank: i + 1,
        modelKey: r.modelKey,
        compositeScore: Math.round(r.score * 1000) / 1000,
        schemaPassRate: `${Math.round(r.schemaPassRate * 100)}%`,
        assertionPassRate: `${Math.round(r.assertionPassRate * 100)}%`,
        avgDurationMs: Math.round(r.avgDurationMs),
        totalCost: `$${r.totalCost.toFixed(6)}`,
        errors: r.errors,
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(leaderboard, null, 2) },
        ],
      };
    },
  );

  // ── validate_output ─────────────────────────────────────────
  server.tool(
    "validate_output",
    "Validate a model response string against a JSON schema and optional regex checks. Returns structured validation results including parsed JSON, schema errors, and pattern violations.",
    {
      response: z
        .string()
        .min(1)
        .describe("The model response text to validate"),
      schemaText: z
        .string()
        .max(20_000)
        .optional()
        .describe(
          "JSON schema to validate against (eval studio schema format)",
        ),
      regexChecks: z
        .array(
          z.object({
            name: z
              .string()
              .describe("Name of this check (e.g. 'no placeholder names')"),
            pattern: z
              .string()
              .describe("Regex pattern to test against the response"),
            mustMatch: z
              .boolean()
              .optional()
              .describe(
                "If true, the pattern MUST match. If false (default), the pattern must NOT match.",
              ),
          }),
        )
        .optional()
        .describe(
          "Regex checks to run against the response. By default patterns must NOT match (detect violations like '[Your Name]').",
        ),
    },
    async ({ response, schemaText, regexChecks }) => {
      const result: Record<string, unknown> = {};

      // Try to parse JSON
      const trimmed = response.trim();
      const candidate =
        trimmed.startsWith("```") && trimmed.endsWith("```") ?
          trimmed.split("\n").slice(1, -1).join("\n").trim()
        : trimmed;

      let parsedJson: unknown = undefined;
      let jsonValid = false;
      try {
        parsedJson = JSON.parse(candidate);
        jsonValid = true;
      } catch (e) {
        result.jsonParseError = e instanceof Error ? e.message : "Invalid JSON";
      }
      result.jsonValid = jsonValid;
      if (jsonValid) result.parsedJson = parsedJson;

      // Schema validation
      if (schemaText?.trim()) {
        const schema = parseSchemaParam(schemaText);
        if (!schema.ok) {
          result.schemaError = schema.error;
        } else if (schema.validator) {
          result.schemaValidation = validateJsonResponse(
            response,
            schema.validator,
          );
        }
      }

      // Regex checks
      if (regexChecks?.length) {
        result.regexChecks = regexChecks.map((check) => {
          try {
            const regex = new RegExp(check.pattern, "gi");
            const matches = response.match(regex);
            const found = !!matches;
            const mustMatch = check.mustMatch ?? false;
            const pass = mustMatch ? found : !found;
            return {
              name: check.name,
              pattern: check.pattern,
              pass,
              found,
              matches: matches?.slice(0, 10) ?? [],
            };
          } catch (e) {
            return {
              name: check.name,
              pattern: check.pattern,
              pass: false,
              error: e instanceof Error ? e.message : "Invalid regex",
            };
          }
        });
      }

      // Overall pass
      const schemaPass =
        !result.schemaValidation ||
        (result.schemaValidation as { status: string }).status === "passed";
      const regexPass =
        !result.regexChecks ||
        (result.regexChecks as Array<{ pass: boolean }>).every((c) => c.pass);
      result.valid = jsonValid && schemaPass && regexPass;

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  // ── suggest_system_prompt ────────────────────────────────────
  server.tool(
    "suggest_system_prompt",
    "Given a failing eval result, generate an improved system prompt. Provide the current system prompt and what went wrong, and get back a rewritten prompt.",
    {
      modelKey: z
        .string()
        .min(1)
        .describe("Model key to use for generating the suggestion"),
      systemPrompt: z
        .string()
        .max(20_000)
        .describe("The current system prompt to improve"),
      prompt: z
        .string()
        .min(1)
        .max(20_000)
        .describe("The original user prompt from the eval"),
      schemaText: z
        .string()
        .max(20_000)
        .optional()
        .describe("The required JSON schema (if any)"),
      responseContent: z
        .string()
        .max(100_000)
        .optional()
        .describe("The model output that failed validation"),
      responseError: z
        .string()
        .max(20_000)
        .optional()
        .describe("Any error from the eval run"),
      validationMessage: z
        .string()
        .max(2_000)
        .optional()
        .describe("Summary of validation failure"),
      validationIssues: z
        .array(z.string().max(2_000))
        .max(50)
        .optional()
        .describe("List of specific validation issues"),
    },
    async ({
      modelKey,
      systemPrompt,
      prompt,
      schemaText,
      responseContent,
      responseError,
      validationMessage,
      validationIssues,
    }) => {
      const provider = createProvider(`${title} - Prompt Repair`);

      const { text } = await generateText({
        model: provider(modelKey),
        temperature: 0.2,
        system:
          "You rewrite system prompts for LLM evals. Produce a stronger replacement system prompt that helps the same model pass the next run. Return only the revised system prompt as plain text. Do not add markdown, bullets, explanations, or backticks.",
        prompt: [
          "Rewrite the current system prompt so the next run is more likely to pass.",
          "",
          `Current system prompt:\n${systemPrompt || "(empty)"}`,
          "",
          schemaText?.trim() ?
            `\nRequired JSON schema:\n${schemaText.trim()}`
          : "",
          validationMessage ?
            `\nValidation summary:\n${validationMessage}`
          : "",
          validationIssues?.length ?
            `\nValidation issues:\n- ${validationIssues.join("\n- ")}`
          : "",
          responseContent?.trim() ?
            `\nModel output that failed:\n${responseContent.trim()}`
          : "",
          responseError?.trim() ? `\nRun error:\n${responseError.trim()}` : "",
          "\nRequirements for the rewritten prompt:",
          "- Preserve the user's core task.",
          "- Be concrete about output format and compliance.",
          "- If a schema is provided, strongly require valid JSON matching it exactly.",
          "- Do not mention hidden chain-of-thought or internal policies.",
          "- Output only the replacement system prompt text.",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      const suggestedPrompt = text.trim();

      if (!suggestedPrompt) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: The model did not return a suggested system prompt.",
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: suggestedPrompt }],
      };
    },
  );

  // ── eval_consistency ──────────────────────────────────────────
  server.tool(
    "eval_consistency",
    "Run the same prompt against one model N times and return a determinism/consistency score. Detects flaky models that pass sometimes but fail others. Optionally validates each run against a schema and/or assertions.",
    {
      modelKey: z.string().min(1).describe("The model key to test"),
      prompt: z.string().min(1).describe("The prompt to send"),
      systemPrompt: z.string().optional().describe("Optional system prompt"),
      runs: z
        .number()
        .int()
        .min(2)
        .max(100)
        .describe("Number of times to run the prompt (e.g. 20)"),
      schemaText: z
        .string()
        .max(20_000)
        .optional()
        .describe("JSON schema to validate each response against"),
      assertions: z
        .array(
          z.object({
            path: z.string().describe("Dot-notation JSON path"),
            equals: z.unknown().optional(),
            isNull: z.boolean().optional(),
            isNotNull: z.boolean().optional(),
            type: z
              .enum(["string", "number", "boolean", "object", "array"])
              .optional(),
            matches: z.string().optional(),
          }),
        )
        .optional()
        .describe("Assertions to check on each response"),
      regexChecks: z
        .array(
          z.object({
            name: z.string(),
            pattern: z.string(),
            mustMatch: z.boolean().optional(),
          }),
        )
        .optional()
        .describe(
          "Regex patterns to check (by default must NOT match, for detecting placeholders)",
        ),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(300_000)
        .optional()
        .describe("Timeout per run in milliseconds"),
      tools: toolsParam,
      toolMocks: toolMocksParam,
      maxTurns: maxTurnsParam,
      providerRouting: providerRoutingParam,
    },
    async ({
      modelKey,
      prompt,
      systemPrompt,
      runs,
      schemaText,
      assertions,
      regexChecks,
      timeoutMs,
      tools: toolDefs,
      toolMocks,
      maxTurns,
      providerRouting,
    }) => {
      const catalog = await getCatalog();
      const catalogModel = catalog.models.find((m) => m.key === modelKey);

      const schema = parseSchemaParam(schemaText);
      if (!schema.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Schema parse error: ${schema.error}`,
            },
          ],
          isError: true,
        };
      }

      const openrouter = createProvider();

      const messages = buildMessages(systemPrompt, prompt);
      const tasks = Array.from({ length: runs }, () => ({
        modelKey,
        messages,
        openrouter,
        pricing: {
          inputCost: catalogModel?.inputCost,
          outputCost: catalogModel?.outputCost,
        },
        timeoutMs,
        tools: toolDefs,
        toolMocks,
        maxTurns,
        providerRouting,
      }));

      const results = await runModelsWithConcurrency(tasks);

      const runDetails = results.map((result, i) => {
        const detail: Record<string, unknown> = { run: i + 1 };

        if (isModelError(result)) {
          detail.pass = false;
          detail.error = result.error;
          return detail;
        }

        detail.response = result.response;
        detail.durationMs = result.durationMs;
        detail.estimatedCost = result.estimatedCost;
        if (result.toolCalls.length > 0) detail.toolCalls = result.toolCalls;

        let pass = true;

        // Schema validation
        if (schema.ok && schema.validator) {
          const v = validateJsonResponse(result.response, schema.validator);
          detail.schemaValidation = v;
          if (v.status === "failed") pass = false;
        }

        // Assertions
        if (assertions?.length) {
          let parsed: unknown = undefined;
          try {
            const candidate = result.response.trim();
            const stripped =
              candidate.startsWith("```") && candidate.endsWith("```") ?
                candidate.split("\n").slice(1, -1).join("\n").trim()
              : candidate;
            parsed = JSON.parse(stripped);
          } catch {
            // not valid JSON
          }

          const assertionRoot: Record<string, unknown> = {
            ...(typeof parsed === "object" && parsed !== null ?
              (parsed as Record<string, unknown>)
            : {}),
            allToolCalls: result.toolCalls,
          };

          const assertionResults = assertions.map((a) => {
            const value = getByPath(assertionRoot, a.path);

            if (!a.path.startsWith("allToolCalls") && parsed === undefined) {
              return {
                path: a.path,
                pass: false,
                reason: "Response is not valid JSON",
              };
            }
            if (a.equals !== undefined) {
              const p = JSON.stringify(value) === JSON.stringify(a.equals);
              return {
                path: a.path,
                pass: p,
                expected: a.equals,
                actual: value,
              };
            }
            if (a.isNull) {
              const p = value === null || value === undefined;
              return { path: a.path, pass: p };
            }
            if (a.isNotNull) {
              const p = value !== null && value !== undefined;
              return { path: a.path, pass: p };
            }
            if (a.type) {
              const actual = Array.isArray(value) ? "array" : typeof value;
              return {
                path: a.path,
                pass: actual === a.type,
                expected: a.type,
                actual,
              };
            }
            if (a.matches) {
              const str =
                typeof value === "string" ? value : JSON.stringify(value);
              return {
                path: a.path,
                pass: new RegExp(a.matches).test(str ?? ""),
              };
            }
            return { path: a.path, pass: true };
          });
          detail.assertions = assertionResults;
          if (!assertionResults.every((a) => a.pass)) pass = false;
        }

        // Regex checks
        if (regexChecks?.length) {
          const checks = regexChecks.map((check) => {
            try {
              const regex = new RegExp(check.pattern, "gi");
              const matches = result.response.match(regex);
              const found = !!matches;
              const mustMatch = check.mustMatch ?? false;
              const p = mustMatch ? found : !found;
              if (!p) pass = false;
              return {
                name: check.name,
                pass: p,
                found,
                matches: matches?.slice(0, 5) ?? [],
              };
            } catch {
              pass = false;
              return { name: check.name, pass: false, error: "Invalid regex" };
            }
          });
          detail.regexChecks = checks;
        }

        detail.pass = pass;
        return detail;
      });

      const passed = runDetails.filter((r) => r.pass).length;
      const failed = runs - passed;
      const passRate = passed / runs;
      const durations = runDetails
        .filter((r) => typeof r.durationMs === "number")
        .map((r) => r.durationMs as number);
      const avgDuration =
        durations.length ?
          Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
      const totalCost = runDetails
        .filter((r) => typeof r.estimatedCost === "number")
        .reduce((sum, r) => sum + (r.estimatedCost as number), 0);

      // Determinism: how often do we get the same structural output?
      const successResponses = runDetails
        .filter((r) => !r.error && typeof r.response === "string")
        .map((r) => r.response as string);
      const uniqueResponses = new Set(successResponses).size;

      const summary = {
        modelKey,
        runs,
        passed,
        failed,
        passRate: `${Math.round(passRate * 100)}%`,
        uniqueResponses,
        determinismScore:
          successResponses.length > 0 ?
            `${Math.round((1 - (uniqueResponses - 1) / Math.max(successResponses.length - 1, 1)) * 100)}%`
          : "N/A",
        avgDurationMs: avgDuration,
        totalCost: `$${totalCost.toFixed(6)}`,
        recommendation:
          passRate === 1 ? "Fully consistent — safe for production"
          : passRate >= 0.9 ? "Mostly reliable — consider retries in production"
          : passRate >= 0.7 ?
            "Flaky — investigate failure cases before shipping"
          : "Unreliable — do not use in production",
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ summary, runs: runDetails }, null, 2),
          },
        ],
      };
    },
  );
  return server;
}
