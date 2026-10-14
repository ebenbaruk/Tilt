"use client";

import type { LeaderboardResponse } from "@tilt/api/public";
import { useEffect, useState } from "react";
import { SponsorBlock } from "@/components/tilt/SponsorBlock";
import { Box } from "@/components/ui/Box";
import { Status } from "@/components/ui/Status";
import { formatAmount, formatSigned } from "@/lib/amount";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { timeLeft } from "@/lib/time";
import styles from "./leaderboard.module.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; board: LeaderboardResponse };

const usd = (baseUnits: string) => `$${formatAmount(baseUnits)}`;

function endsLabel(endsAt: string): string {
  const left = timeLeft(endsAt);
  return left === "ended" ? "ended" : `ends in ${left}`;
}

export function LeaderboardView() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getApi()
      .leaderboard(controller.signal)
      .then((board) => setState({ kind: "ready", board }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <Status tone="pending">loading leaderboard</Status>;
  if (state.kind === "error") return <Status tone="loss">{state.message}</Status>;

  const { competition, sponsor, entries, dropSeedHash, dropSeed } = state.board;
  // SponsorBlock prints "ends in …": an ended campaign shows no countdown rather than "ends in ended".
  const sponsorLeft = sponsor ? timeLeft(sponsor.endsAt) : "ended";
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {competition ? (
          <p className={styles.muted}>
            <span className={styles.strong}>{competition.name}</span> · pool{" "}
            <span className={styles.money}>{usd(competition.pool)}</span> · {endsLabel(competition.endsAt)}
          </p>
        ) : (
          <p className={styles.muted}>No competition is running right now.</p>
        )}
        {entries.length === 0 ? (
          <p className={styles.muted}>No ranked players yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">rank</th>
                <th scope="col">player</th>
                <th scope="col" className={styles.right}>
                  net USDC
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.rank} className={entry.isYou ? styles.you : undefined}>
                  <td>{entry.rank}</td>
                  <td>
                    {/* bdi: a handle with right-to-left marks must not flip the "(you)" after it. */}
                    <bdi>{entry.handle}</bdi>
                    {entry.isYou && " (you)"}
                  </td>
                  <td className={`${styles.right} ${styles.net}`}>{formatSigned(entry.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <aside className={styles.side}>
        {sponsor && (
          <Box tone="brand">
            <SponsorBlock
              name={sponsor.name}
              tagline={sponsor.tagline}
              pool={usd(sponsor.pool)}
              endsIn={sponsorLeft === "ended" ? undefined : sponsorLeft}
            />
          </Box>
        )}
        <Box title="drop commitment">
          <p className={styles.muted}>
            Random drops are drawn from a seed committed before the competition starts. Its sha256 is published now; the
            seed is revealed at the end so anyone can recheck every drop.
          </p>
          <dl className={styles.commit}>
            <dt>sha256(seed)</dt>
            <dd data-testid="seed-hash">{dropSeedHash ?? "not committed yet"}</dd>
            <dt>seed</dt>
            <dd data-testid="seed">{dropSeed ?? "revealed when the competition ends"}</dd>
          </dl>
        </Box>
      </aside>
    </div>
  );
}
