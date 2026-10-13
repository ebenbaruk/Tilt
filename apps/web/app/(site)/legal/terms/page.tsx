import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Terms (draft)" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <h2>Who can play</h2>
      <ul>
        <li>You must be 18 or older, or the legal gambling age where you live if higher.</li>
        <li>
          Tilt is not available in the United States, the United Kingdom, France or other restricted jurisdictions.
          Region is checked by IP, by declaration and by identity verification. Getting around it (VPN, someone
          else&apos;s identity) is a breach of these terms.
        </li>
        <li>One account per person.</li>
      </ul>
      <h2>The service</h2>
      <p>
        Games run in a program on Solana. Draws come from a verifiable random function; each round can be checked at{" "}
        <Link href="/verify">/verify</Link>. Balances are held in USDC. Tilt takes 1% of the gain on winning rounds.
      </p>
      <h2>Deposits and withdrawals</h2>
      <p>
        The first deposit has a minimum and a one-time onboarding fee. Withdrawals are made from the website to your own
        wallet, subject to per-withdrawal and daily caps and to review above set thresholds.
      </p>
      <h2>Competitions</h2>
      <p>Sponsored competitions and drops run under their own official rules, published with each competition.</p>
      <h2>To be completed</h2>
      <p>
        Licensing entity, governing law, disputes, account closure, inactive accounts and liability: pending counsel.
      </p>
    </LegalPage>
  );
}
