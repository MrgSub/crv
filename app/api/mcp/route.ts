import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp-tools";
import { getOpenRouterApiKey, MISSING_OPENROUTER_API_KEY_MESSAGE } from "@/lib/openrouter-auth";

// Stateless mode: each request is self-contained (no session tracking).
// This is the simplest model for a deployed remote MCP server.
function createTransport() {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
}

async function handleRequest(req: Request) {
  const apiKey = getOpenRouterApiKey(req.headers);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: MISSING_OPENROUTER_API_KEY_MESSAGE }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  const transport = createTransport();
  const server = createMcpServer({
    resolveApiKey: () => apiKey,
    referer: req.headers.get("origin") ?? req.headers.get("referer") ?? "https://crv.sh",
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function GET(req: Request) {
  return handleRequest(req);
}

export async function POST(req: Request) {
  return handleRequest(req);
}

export async function DELETE(req: Request) {
  return handleRequest(req);
}
