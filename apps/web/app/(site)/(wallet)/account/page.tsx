import type { Metadata } from "next";
import { Page } from "@/components/site/Page";
import { GeoGate } from "@/components/site/GeoGate";
import { AccountView } from "./AccountView";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default function AccountPage() {
  return (
    <Page
      eyebrow="account"
      title="Your Tilt account"
      lede="Deposits, withdrawals, terminal sessions and limits. Money only moves from this page, never from the terminal."
    >
      <GeoGate blocked={<AccountView withdrawOnly />}>
        <AccountView />
      </GeoGate>
    </Page>
  );
}
