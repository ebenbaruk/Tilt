import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Responsible gaming (draft)" };

export default function ResponsibleGamingPage() {
  return (
    <LegalPage title="Responsible gaming">
      <p>
        Every game has a house edge: over time, the house wins. Play for fun, with money you can afford to lose, and
        never to win back losses.
      </p>
      <h2>Tools on your account</h2>
      <ul>
        <li>Daily deposit limit and daily loss limit. Lowering applies at once; raising waits 24 hours.</li>
        <li>Self-exclusion from 24 hours to 10 years. It cannot be lifted early; you can still withdraw.</li>
        <li>Revoke terminal sessions at any time.</li>
      </ul>
      <p>
        Set them on your <Link href="/account">account page</Link>.
      </p>
      <h2>Warning signs</h2>
      <ul>
        <li>Playing longer or with more money than you meant to.</li>
        <li>Chasing losses, or borrowing to play.</li>
        <li>Hiding how much you play, or feeling restless when you don&apos;t.</li>
      </ul>
      <h2>Get help</h2>
      <p>
        If gambling stops being fun, talk to someone. Free, confidential help exists in most countries; a list of
        support organisations by country will be published here with the final version. Gamblers Anonymous runs meetings
        worldwide: <a href="https://www.gamblersanonymous.org">gamblersanonymous.org</a>.
      </p>
      <p>Under-18s may not play. If a minor uses your device, use parental controls.</p>
    </LegalPage>
  );
}
