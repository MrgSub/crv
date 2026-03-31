export const CONNECT_AGENT_TOOLS = [
  { name: "list_models", description: "Browse models with pricing and context windows" },
  { name: "eval_prompt", description: "Run a prompt against selected models" },
  { name: "eval_batch", description: "Run against all models in one call" },
  { name: "eval_suite", description: "Multi-test-case pass/fail matrix" },
  { name: "eval_rank", description: "Rank models by composite score" },
  { name: "eval_consistency", description: "Detect flaky models with repeated runs" },
  { name: "validate_output", description: "Check a response against JSON schema" },
  { name: "suggest_system_prompt", description: "Auto-repair a failing system prompt" },
] as const;

export function getRequestOrigin(headers: Headers): string | undefined {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();

  if (!host) {
    return undefined;
  }

  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");

  return `${protocol}://${host}`;
}

export function buildMcpUrl(origin?: string) {
  return `${origin || "https://crv.sh"}/api/mcp`;
}

export function buildClientConfig(mcpUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        crv: {
          type: "url",
          url: mcpUrl,
          headers: {
            Authorization: "Bearer sk-or-...",
          },
        },
      },
    },
    null,
    2,
  );
}

export function buildConnectAgentMarkdown(mcpUrl: string) {
  const toolLines = CONNECT_AGENT_TOOLS.map((tool) => `- \`${tool.name}\`: ${tool.description}`);
  const skillUrl = new URL("/SKILL.md", mcpUrl).toString();

  return [
    "# Connect your agent",
    "",
    "crv.sh exposes every eval tool as an MCP server. Point any MCP-compatible client at the remote endpoint and your agent can list models, run evals, validate outputs, and repair prompts.",
    "",
    "## Remote endpoint",
    "",
    `\`${mcpUrl}\``,
    "",
    "Stateless HTTP transport. Every request is self-contained.",
    "",
    "## Available tools",
    "",
    ...toolLines,
    "",
    `Read the [full Eval MCP skill guide](${skillUrl}).`,
    "",
    "## Client config",
    "",
    "```json",
    buildClientConfig(mcpUrl),
    "```",
    "",
    "Send your OpenRouter key with `Authorization: Bearer sk-or-...`.",
    "",
  ].join("\n");
}
