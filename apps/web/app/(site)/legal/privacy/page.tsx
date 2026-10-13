import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Privacy (draft)" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <h2>What the mod sees</h2>
      <p>
        The Claude Code mod reads only when an agent turn starts and ends. It never reads your prompts, your code or
        your tool calls, and its source is public.
      </p>
      <h2>What Tilt stores</h2>
      <ul>
        <li>Your login identity from Privy (email, Google, X or wallet address) and your Solana wallet address.</li>
        <li>Terminal sessions, responsible-gaming limits and self-exclusions.</li>
        <li>Your country as derived from your IP, to apply regional restrictions.</li>
        <li>Identity verification data, held by the verification provider, when required.</li>
      </ul>
      <h2>What is public</h2>
      <p>Bets, outcomes and payouts are Solana transactions: they are public and permanent by design.</p>
      <h2>Processors</h2>
      <p>Privy (login and wallets), card onramp providers, the hosting provider and the identity provider.</p>
      <h2>To be completed</h2>
      <p>Controller identity, legal bases, retention periods, transfers and your rights (GDPR): pending counsel.</p>
    </LegalPage>
  );
}
