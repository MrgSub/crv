import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createOpenRouterClient } from "@/lib/openrouter";

export const maxDuration = 60;

const requestSchema = z.object({
  modelKey: z.string().min(1),
  systemPrompt: z.string().max(20_000),
  prompt: z.string().min(1).max(20_000),
  schemaText: z.string().max(20_000).optional(),
  responseContent: z.string().max(100_000).optional(),
  responseError: z.string().max(20_000).optional(),
  validationMessage: z.string().max(2_000).optional(),
  validationIssues: z.array(z.string().max(2_000)).max(50).optional(),
  openRouterApiKey: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const payload = requestSchema.parse(await request.json());
  const apiKey = payload.openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No OpenRouter API key provided. Add one in settings or set OPENROUTER_API_KEY on the server." },
      { status: 400 },
    );
  }
  const referer = request.headers.get("origin") ?? "http://localhost:3000";

  try {
    const provider = createOpenRouterClient({
      apiKey,
      referer,
      title: "AI Eval Studio - Prompt Repair",
    });

    const { text } = await generateText({
      model: provider(payload.modelKey),
      temperature: 0.2,
      system:
        "You rewrite system prompts for LLM evals. Produce a stronger replacement system prompt that helps the same model pass the next run. Return only the revised system prompt as plain text. Do not add markdown, bullets, explanations, or backticks.",
      prompt: [
        "Rewrite the current system prompt so the next run is more likely to pass.",
        "",
        `Current system prompt:\n${payload.systemPrompt || "(empty)"}`,
        "",
        payload.schemaText?.trim() ? `\nRequired JSON schema:\n${payload.schemaText.trim()}` : "",
        payload.validationMessage ? `\nValidation summary:\n${payload.validationMessage}` : "",
        payload.validationIssues?.length
          ? `\nValidation issues:\n- ${payload.validationIssues.join("\n- ")}`
          : "",
        payload.responseContent?.trim()
          ? `\nModel output that failed:\n${payload.responseContent.trim()}`
          : "",
        payload.responseError?.trim() ? `\nRun error:\n${payload.responseError.trim()}` : "",
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
      return NextResponse.json(
        { error: "The model did not return a suggested system prompt." },
        { status: 502 },
      );
    }

    return NextResponse.json({ suggestedPrompt });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate a suggested system prompt.",
      },
      { status: 500 },
    );
  }
}
