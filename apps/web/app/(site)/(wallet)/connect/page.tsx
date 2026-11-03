import type { Metadata } from "next";
import { Page } from "@/components/site/Page";
import { GeoGate } from "@/components/site/GeoGate";
import { parseUserCode } from "@/lib/device";
import { ConnectFlow } from "./ConnectFlow";

export const metadata: Metadata = { title: "Connect a terminal", robots: { index: false } };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  // Shown as a reminder only: the player types the code from their terminal.
  const linkCode = parseUserCode(Array.isArray(code) ? code[0] : code);
  return (
    <Page
      eyebrow="tilt login"
      title="Connect your terminal"
      lede="Approve Tilt running in your coding agent. It gets a game-only session: it can play, never withdraw."
    >
      <GeoGate>
        <ConnectFlow linkCode={linkCode} />
      </GeoGate>
    </Page>
  );
}
