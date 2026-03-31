import { headers } from "next/headers";

import {
  CONNECT_AGENT_TOOLS,
  buildClientConfig,
  buildMcpUrl,
  getRequestOrigin,
} from "@/lib/connect-agent";

export default async function Page() {
  const requestHeaders = await headers();
  const origin = getRequestOrigin(requestHeaders);
  const mcpUrl = buildMcpUrl(origin);
  const clientConfig = buildClientConfig(mcpUrl);

  return (
    <main id="main-content" className="min-h-screen overflow-x-hidden bg-[var(--page-bg)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--hero-bg)] px-6 py-8 shadow-[var(--shadow-lg)] sm:px-8 lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(78,203,255,0.14),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(93,122,255,0.16),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_100%)]" />
          <div className="pointer-events-none absolute inset-y-0 right-[-8%] w-[44%] bg-[linear-gradient(180deg,rgba(78,203,255,0.12),rgba(78,203,255,0))] blur-3xl" />

          <div className="relative">
            <div className="max-w-3xl space-y-4">
              <span className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[color:rgba(10,18,31,0.74)] px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-[var(--accent)] shadow-[0_0_0_1px_rgba(78,203,255,0.05)]">
                MCP Server
              </span>
              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Connect your agent.</h1>
              <p className="max-w-3xl text-base leading-7 text-[var(--ink-soft)] sm:text-lg">
                crv.sh exposes every eval tool as an MCP server. Point any MCP-compatible client at the remote endpoint
                and your agent can list models, run evals, validate outputs, and repair prompts.
              </p>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <article className="rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.98))] p-5 shadow-[var(--shadow-md)]">
                <h2 className="text-lg font-semibold">Remote endpoint</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">The MCP server is available at:</p>
                <code className="mt-3 block overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 font-mono text-sm text-[var(--accent)]">
                  {mcpUrl}
                </code>
                <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">
                  Stateless HTTP transport. Every request is self-contained.
                </p>
              </article>

              <article className="rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.98))] p-5 shadow-[var(--shadow-md)]">
                <h2 className="text-lg font-semibold">Available tools</h2>
                <div className="mt-4 space-y-2">
                  {CONNECT_AGENT_TOOLS.map((tool) => (
                    <div key={tool.name} className="flex items-baseline gap-3 rounded-xl border border-[var(--line)] bg-[var(--canvas-soft)] px-3 py-2">
                      <code className="shrink-0 font-mono text-xs text-[var(--accent)]">{tool.name}</code>
                      <span className="text-sm text-[var(--muted-ink)]">{tool.description}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <article className="mt-6 rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.98))] p-5 shadow-[var(--shadow-md)]">
              <h2 className="text-lg font-semibold">Client config</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                Add this to your MCP client config. Works with Amp, Claude Code, Cursor, Windsurf, and any
                Streamable HTTP MCP client.
              </p>
              <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--canvas-soft)] p-4">
                <pre className="overflow-x-auto font-mono text-sm leading-6 text-[var(--ink)]">{clientConfig}</pre>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">
                Send your OpenRouter key with <code className="font-mono text-xs">Authorization: Bearer sk-or-...</code>.
              </p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
