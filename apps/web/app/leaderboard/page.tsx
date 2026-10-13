import type { Metadata } from "next";
import { Page } from "@/components/site/Page";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <Page
      eyebrow="competition"
      title="Leaderboard"
      lede="Ranked by net gain over the competition window, not by balance, so a big deposit doesn't buy a rank."
    >
      <LeaderboardView />
    </Page>
  );
}
