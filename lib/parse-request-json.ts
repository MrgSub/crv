import { NextResponse } from "next/server";
import type { z } from "zod";

export async function parseRequestJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<
  { ok: true; data: z.infer<Schema> } | { ok: false; response: NextResponse }
> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body.", issues: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
