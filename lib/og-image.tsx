import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG_ALT = "crv.sh — Connect your agent: MCP eval tools";

export function createSocialImageResponse() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        background: "#060b14",
        padding: "80px 100px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background gradients matching the site's hero */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "-10%",
          width: "60%",
          height: "80%",
          background:
            "radial-gradient(circle, rgba(78, 203, 255, 0.15) 0%, transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-20%",
          right: "-10%",
          width: "70%",
          height: "90%",
          background:
            "radial-gradient(circle, rgba(93, 122, 255, 0.12) 0%, transparent 70%)",
        }}
      />

      {/* Grid pattern overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(125, 147, 178, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(125, 147, 178, 0.08) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          opacity: 0.5,
        }}
      />

      {/* Content container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 900,
          marginTop: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(10, 18, 31, 0.8)",
              border: "1px solid rgba(78, 203, 255, 0.2)",
              borderRadius: 999,
              padding: "8px 20px",
              boxShadow: "0 0 20px rgba(78, 203, 255, 0.1)",
            }}
          >
            <span
              style={{
                fontSize: 16,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#4ecbff",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontWeight: 500,
              }}
            >
              MCP Server
            </span>
          </div>
        </div>

        <h1
          style={{
            fontSize: 82,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.04em",
            color: "#edf6ff",
            margin: 0,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
            textShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          Connect your agent.
        </h1>

        <p
          style={{
            fontSize: 32,
            lineHeight: 1.4,
            color: "#c6d7ef",
            margin: 0,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
            maxWidth: 800,
          }}
        >
          List models, run evals, validate JSON, and repair prompts — stateless
          HTTP MCP.
        </p>
      </div>

      {/* Footer / Logo area */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "linear-gradient(135deg, #4ecbff 0%, #1db0f3 100%)",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 24px rgba(78, 203, 255, 0.3)",
          }}
        >
          <svg
            width='28'
            height='28'
            viewBox='0 0 24 24'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M4 12C4 12 7.5 4 12 4C16.5 4 20 12 20 12C20 12 16.5 20 12 20C7.5 20 4 12 4 12Z'
              stroke='#04111f'
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <circle cx='12' cy='12' r='3' stroke='#04111f' strokeWidth='2.5' />
          </svg>
        </div>
        <span
          style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#edf6ff",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          }}
        >
          crv.sh
        </span>
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
