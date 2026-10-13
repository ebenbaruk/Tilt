import type { Metadata } from "next";
import { Page } from "@/components/site/Page";
import { GeoGate } from "@/components/site/GeoGate";
import { parseUserCode } from "@/lib/device";
import { ConnectFlow } from "./ConnectFlow";

export const metadata: Metadata = { title: "Connect a terminal", robots: { index: false } };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  const userCode = parseUserCode(Array.isArray(code) ? code[0] : code);
  return (
    <Page
      eyebrow="tilt login"
      title="Connect your terminal"
      lede="Approve the Tilt mod running in Claude Code. It gets a game-only session: it can play, never withdraw."
    >
      <GeoGate>
        <ConnectFlow userCode={userCode} />
      </GeoGate>
    </Page>
  );
}
