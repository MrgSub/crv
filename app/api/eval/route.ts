import { streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCatalog } from "@/lib/catalog";
import { createOpenRouterClient, getOpenRouterUsage } from "@/lib/openrouter";
import {
  getOpenRouterApiKey,
  MISSING_OPENROUTER_API_KEY_MESSAGE,
} from "@/lib/openrouter-auth";
import { parseRequestJson } from "@/lib/parse-request-json";
import { estimateCost } from "@/lib/pricing";

export const maxDuration = 120;

const requestSchema = z.object({
  systemPrompt: z.string().max(20_000).default(""),
  prompt: z.string().min(1).max(20_000),
  history: z
    .array(
      z.object({
        prompt: z.string(),
        responses: z.record(z.string(), z.string()),
      }),
    )
    .default([]),
  selectedModels: z
    .array(
      z.object({
        key: z.string(),
      }),
    )
    .min(1),
  timeoutMs: z.number().int().min(500).max(300_000).optional(),
  providerRouting: z
    .object({
      order: z.array(z.string()).optional(),
      allow_fallbacks: z.boolean().optional(),
      require_parameters: z.boolean().optional(),
      data_collection: z.string().optional(),
      only: z.array(z.string()).optional(),
      ignore: z.array(z.string()).optional(),
      quantizations: z.array(z.string()).optional(),
      sort: z.string().optional(),
    })
    .optional(),
});

type ResponseEvent =
  | { type: "model-start"; modelKey: string }
  | { type: "model-chunk"; modelKey: string; delta: string; elapsedMs: number }
  | {
      type: "model-finish";
      modelKey: string;
      durationMs: number;
      ttftMs?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      estimatedCost?: number;
      finishReason?: string | null;
    }
  | { type: "model-error"; modelKey: string; error: string; durationMs: number }
  | { type: "batch-finish" };

function toModelMessages(
  systemPrompt: string,
  history: Array<{ prompt: string; responses: Record<string, string> }>,
  modelKey: string,
  prompt: string,
) {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }

  for (const turn of history) {
    messages.push({ role: "user", content: turn.prompt });

    const priorResponse = turn.responses[modelKey];
    if (priorResponse?.trim()) {
      messages.push({ role: "assistant", content: priorResponse });
    }
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

function encodeEvent(event: ResponseEvent) {
  return `${JSON.stringify(event)}\n`;
}

async function streamOpenRouterModel(args: {
  modelKey: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  send: (event: ResponseEvent) => void;
  apiKey: string;
  referer: string;
  title: string;
  pricing?: { inputCost?: number; outputCost?: number };
  abortSignal?: AbortSignal;
  providerRouting?: Record<string, unknown>;
}) {
  const {
    modelKey,
    messages,
    send,
    apiKey,
    referer,
    title,
    pricing,
    abortSignal,
    providerRouting,
  } = args;
  const startedAt = Date.now();
  let firstTokenAt: number | undefined;

  send({ type: "model-start", modelKey });

  const openrouter = createOpenRouterClient({ apiKey, referer, title });
  const result = streamText({
    model: openrouter(modelKey, {
      usage: { include: true },
      ...(providerRouting ? { provider: providerRouting } : {}),
    }),
    messages,
    abortSignal,
  });

  for await (const delta of result.textStream) {
    if (!firstTokenAt) {
      firstTokenAt = Date.now();
    }

    send({
      type: "model-chunk",
      modelKey,
      delta,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const usage = await result.usage;
  const providerMetadata = await result.providerMetadata;
  const openRouterUsage = getOpenRouterUsage(providerMetadata);
  const durationMs = Date.now() - startedAt;
  const estimatedCost = estimateCost(
    {
      promptTokens: openRouterUsage?.promptTokens ?? usage.inputTokens,
      completionTokens: openRouterUsage?.completionTokens ?? usage.outputTokens,
    },
    { inputCost: pricing?.inputCost, outputCost: pricing?.outputCost },
  );

  send({
    type: "model-finish",
    modelKey,
    durationMs,
    ttftMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
    promptTokens: openRouterUsage?.promptTokens ?? usage.inputTokens,
    completionTokens: openRouterUsage?.completionTokens ?? usage.outputTokens,
    totalTokens: openRouterUsage?.totalTokens ?? usage.totalTokens,
    estimatedCost,
    finishReason: await result.rawFinishReason,
  });
}

export async function POST(request: Request) {
  const parsed = await parseRequestJson(request, requestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const payload = parsed.data;
  const apiKey = getOpenRouterApiKey(request.headers);

  if (!apiKey) {
    return NextResponse.json(
      { error: MISSING_OPENROUTER_API_KEY_MESSAGE },
      { status: 401 },
    );
  }
  const catalog = await getCatalog();
  const catalogByKey = new Map(
    catalog.models.map((model) => [model.key, model]),
  );
  const referer = request.headers.get("origin") ?? "http://localhost:3000";
  const title = "crv.sh";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ResponseEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      void (async () => {
        const MAX_CONCURRENT = 50;
        const queue = [...payload.selectedModels];
        let active = 0;
        let idx = 0;

        await new Promise<void>((resolveAll) => {
          function next() {
            if (idx >= queue.length && active === 0) {
              resolveAll();
              return;
            }

            while (active < MAX_CONCURRENT && idx < queue.length) {
              const selection = queue[idx++];
              active++;
              runOne(selection).finally(() => {
                active--;
                next();
              });
            }
          }

          async function runOne(selection: { key: string }) {
            const catalogModel = catalogByKey.get(selection.key);

            if (!catalogModel) {
              send({
                type: "model-error",
                modelKey: selection.key,
                error: "This model is no longer available in the catalog.",
                durationMs: 0,
              });
              return;
            }

            const messages = toModelMessages(
              payload.systemPrompt,
              payload.history,
              selection.key,
              payload.prompt,
            );

            const startedAt = Date.now();
            const abortSignal =
              payload.timeoutMs ?
                AbortSignal.timeout(payload.timeoutMs)
              : undefined;

            try {
              await streamOpenRouterModel({
                modelKey: selection.key,
                messages,
                send,
                apiKey: apiKey!,
                referer,
                title,
                pricing: {
                  inputCost: catalogModel.inputCost,
                  outputCost: catalogModel.outputCost,
                },
                abortSignal,
                providerRouting: payload.providerRouting,
              });
            } catch (error) {
              const isTimeout =
                error instanceof DOMException && error.name === "TimeoutError";
              const message =
                isTimeout ? `Timed out after ${payload.timeoutMs! / 1000}s`
                : error instanceof Error ? error.message
                : "The model request failed.";

              send({
                type: "model-error",
                modelKey: selection.key,
                error: message,
                durationMs: Date.now() - startedAt,
              });
            }
          }

          next();
        });

        send({ type: "batch-finish" });
        controller.close();
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
