import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { OG_ALT, OG_SIZE } from "@/lib/og-image";

import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "crv.sh — Connect your agent",
  description:
    "Connect any MCP-compatible client to crv.sh and run model eval, validation, and prompt repair tools over HTTP.",
  metadataBase: new URL("https://crv.sh"),
  openGraph: {
    title: "crv.sh — Connect your agent",
    description:
      "Connect any MCP-compatible client to crv.sh and run model eval, validation, and prompt repair tools over HTTP.",
    siteName: "crv.sh",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        alt: OG_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "crv.sh — Connect your agent",
    description:
      "Connect any MCP-compatible client to crv.sh and run model eval, validation, and prompt repair tools over HTTP.",
    images: ["/twitter-image"],
  },
};

export const viewport: Viewport = {
  themeColor: "#060b14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <a className='skip-link' href='#main-content'>
          Skip to Main Content
        </a>
        {children}
      </body>
    </html>
  );
}
