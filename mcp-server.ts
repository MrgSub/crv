#!/usr/bin/env npx tsx
console.error(
  "The local stdio MCP server is no longer supported. Use the HTTP MCP endpoint (/api/mcp) with Authorization: Bearer <key> on each request.",
);
process.exit(1);
