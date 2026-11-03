"use client";

import Link from "next/link";
import type { VerifyResponse } from "@tilt/api/public";
import { useEffect, useState } from "react";
import { RoundDetail } from "@/components/tilt/RoundDetail";
import { Box } from "@/components/ui/Box";
import { Status } from "@/components/ui/Status";
import { compareAmounts, formatAmount, formatSigned } from "@/lib/amount";
import { ApiError, getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { GAME_NAMES } from "@/lib/round";
import { accountUrl, rollupTxUrl } from "@/lib/solana";
import styles from "../verify.module.css";

type State =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: VerifyResponse };

export function VerifyResult({ signature }: { signature: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getApi()
      .verifyRound(signature, controller.signal)
      .then((result) => setState({ kind: "ready", result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === "NOT_FOUND") setState({ kind: "notFound" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [signature]);

  switch (state.kind) {
    case "loading":
      return <Status tone="pending">replaying round</Status>;
    case "notFound":
      return (
        <Box tone="loss" title="round not found">
          <p>
            No settled Tilt round with this signature. A round can take a few seconds to index; otherwise check the
            signature. <Link href="/verify">Try another</Link>.
          </p>
        </Box>
      );
    case "error":
      return (
        <Box tone="loss" title="couldn't verify">
          <p>{state.message}</p>
        </Box>
      );
    case "ready":
      return <Verified result={state.result} />;
  }
}

function Verified({ result }: { result: VerifyResponse }) {
  const txUrl = rollupTxUrl(result.signature);
  const { replayed, onChain } = result;
  const rows = [
    { field: "stake", replay: replayed.stake, chain: onChain.stake },
    { field: "payout", replay: replayed.payout, chain: onChain.payout },
    { field: "fee", replay: replayed.fee, chain: onChain.fee },
  ];
  return (
    <div className={styles.stack}>
      <Box tone={!result.matches ? "loss" : result.choicesRecorded ? "success" : "plain"}>
        {result.matches && result.choicesRecorded ? (
          <Status tone="success">
            Replay matches on-chain. This round was dealt by the VRF and paid by the rules.
          </Status>
        ) : result.matches ? (
          <Status tone="info">
            The draws are the VRF&apos;s and the payout fits the rules, but the player&apos;s choices weren&apos;t
            recorded for this round, so the replay can&apos;t check them.
          </Status>
        ) : (
          <Status tone="loss">Replay does not match on-chain. Keep this signature and report it.</Status>
        )}
      </Box>

      <Box title="round">
        <dl className={styles.facts}>
          <dt>game</dt>
          <dd>{GAME_NAMES[result.game]}</dd>
          <dt>round</dt>
          <dd>#{result.round.toLocaleString("en-US")}</dd>
          <dt>player</dt>
          <dd className={styles.mono}>
            <a href={accountUrl(result.player)} target="_blank" rel="noreferrer">
              {result.player}
            </a>
          </dd>
          <dt>signature</dt>
          <dd className={styles.mono}>
            {txUrl ? (
              <a href={txUrl} target="_blank" rel="noreferrer">
                {result.signature}
              </a>
            ) : (
              result.signature
            )}
          </dd>
          <dt>vrf randomness</dt>
          <dd className={styles.mono} data-testid="randomness">
            {result.randomness}
          </dd>
        </dl>
      </Box>

      <div className={styles.columns}>
        <Box title="replayed from randomness">
          <RoundDetail detail={replayed.detail} />
          <p className={styles.muted}>
            net <span className={styles.money}>{formatSigned(replayed.net)}</span> USDC
          </p>
        </Box>
        <Box title="replay vs on-chain">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">field</th>
                <th scope="col">replay</th>
                <th scope="col">on-chain</th>
                <th scope="col">
                  <span className="visually-hidden">match</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const same = compareAmounts(row.replay, row.chain) === 0;
                return (
                  <tr key={row.field}>
                    <th scope="row">{row.field}</th>
                    <td>{formatAmount(row.replay)}</td>
                    <td>{formatAmount(row.chain)}</td>
                    <td className={same ? styles.ok : styles.bad} aria-label={same ? "matches" : "differs"}>
                      {same ? "✓" : "✗"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.muted}>Amounts in USDC. The fee is 1% of the gain, on winning rounds only.</p>
        </Box>
      </div>
    </div>
  );
}
