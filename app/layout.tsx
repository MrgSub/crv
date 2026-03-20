import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

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
  title: "AI Eval Studio",
  description: "Compare streamed responses across OpenRouter models with live time and cost estimates.",
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
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <a className="skip-link" href="#main-content">
          Skip to Main Content
        </a>
        {children}
      </body>
    </html>
  );
}
