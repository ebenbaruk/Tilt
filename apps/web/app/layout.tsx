import type { Metadata, Viewport } from "next";
import { Anton, Archivo, Caprasimo, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

// Downloaded at build time and served from this origin: no runtime request to Google.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-jetbrains",
  display: "swap",
});
// Landing only: serif headlines, condensed display and grotesk body (spec: brand v2).
const caprasimo = Caprasimo({ subsets: ["latin"], weight: "400", variable: "--font-caprasimo", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Tilt · the casino you play while your agent codes", template: "%s · Tilt" },
  description:
    "Blackjack, roulette, baccarat, slots and mines inside Claude Code. USDC on Solana, provably fair, played while your agent works. 18+.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request: Next can only put the CSP nonce (proxy.ts) on a page rendered with it.
  await connection();
  return (
    <html lang="en" className={`${mono.variable} ${caprasimo.variable} ${anton.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
