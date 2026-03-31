import { NextResponse } from "next/server";

import { buildConnectAgentMarkdown, buildMcpUrl } from "@/lib/connect-agent";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const markdown = buildConnectAgentMarkdown(buildMcpUrl(origin));

  return new NextResponse(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}
