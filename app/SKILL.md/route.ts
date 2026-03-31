import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET() {
  const content = await readFile(
    join(process.cwd(), "app", "SKILL.md", "content.md"),
    "utf-8",
  );

  return new NextResponse(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}
