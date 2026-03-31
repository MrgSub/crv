# crv.sh

**Stay ahead of the curve.** Multi-model LLM eval studio with a live dark-mode console and an MCP server for AI-native workflows.

Compare, rank, and validate AI outputs across every model on OpenRouter — with real-time latency, cost tracking, and schema health.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server
npm run dev
# → http://localhost:1339
```

## MCP server

crv.sh ships an MCP (Model Context Protocol) server that exposes the full eval toolkit as tools. This lets AI agents — like Amp, Claude Code, Cursor, or any MCP-compatible client — run evals, compare models, and validate outputs programmatically.

### Tools

| Tool                    | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `list_models`           | List available OpenRouter models with pricing and context windows            |
| `eval_prompt`           | Run a prompt against one or more models, get responses with latency/cost     |
| `eval_batch`            | Run one prompt against ALL models (or a filtered subset) in a single call    |
| `eval_suite`            | Run multiple test cases against multiple models — returns a pass/fail matrix |
| `eval_rank`             | Rank models from eval results by composite score (compliance, latency, cost) |
| `eval_consistency`      | Run the same prompt N times against one model to detect flakiness            |
| `validate_output`       | Validate a response against a JSON schema and regex checks                   |
| `suggest_system_prompt` | Given a failing eval, generate an improved system prompt                     |

### Remote HTTP MCP

For the hosted `/api/mcp` endpoint, send your OpenRouter key on every request with `Authorization: Bearer <key>`.

```json
{
  "mcpServers": {
    "crv": {
      "type": "url",
      "url": "https://crv.sh/api/mcp",
      "headers": {
        "Authorization": "Bearer sk-or-..."
      }
    }
  }
}
```

### Example usage (from an AI agent)

Once connected, your agent can call tools like:

```
→ list_models({ provider: "anthropic" })
→ eval_prompt({ prompt: "Explain monads in one sentence", models: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o"] })
→ eval_batch({ prompt: "What is 2+2?", schemaText: '{"type":"object","properties":{"answer":{"type":"number"}}}' })
→ eval_consistency({ modelKey: "openai/gpt-4o", prompt: "Generate a UUID", runs: 10 })
```

## Deployment

The app deploys on any Node.js 20+ host. A Railway config (`_railway.json`) is included.

```bash
npm run build
npm run start
```

## Stack

- **Next.js 16** with App Router
- **Tailwind CSS v4**
- **OpenRouter** via `@openrouter/ai-sdk-provider`
- **MCP SDK** (`@modelcontextprotocol/sdk`)
- **Zustand** for client state
- **TanStack Table** for the results grid
