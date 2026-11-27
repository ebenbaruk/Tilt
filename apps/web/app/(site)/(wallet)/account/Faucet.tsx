"use client";

import type { AccountResponse } from "@tilt/api/public";
import { useState } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { solanaCluster } from "@/lib/config";
import { claimErrorPhase, claimPhase, faucetOffer, type FaucetPhase } from "@/lib/faucet";
import { solanaTxUrl } from "@/lib/solana";
import styles from "./account.module.css";

/** Devnet only: test USDC into the player's wallet, to deposit as usual. */
export function Faucet({ faucet, onClaimed }: { faucet: AccountResponse["faucet"]; onClaimed: () => void }) {
  const { auth } = useTiltAuth();
  const [phase, setPhase] = useState<FaucetPhase>({ kind: "idle" });
  const offer = faucetOffer(solanaCluster(), faucet, new Date());
  if (!offer) return null;

  async function claim() {
    setPhase({ kind: "working" });
    try {
      setPhase(claimPhase(await getApi().faucet(await auth(), { claimId: crypto.randomUUID() })));
    } catch (error) {
      setPhase(claimErrorPhase(error));
    }
    // The wallet balance, or when the next claim opens.
    onClaimed();
  }

  return (
    <div className={styles.fund}>
      <p className={styles.muted}>Tilt runs on Solana devnet for now: test USDC has no value.</p>
      {offer.kind === "ready" ? (
        <div>
          <Button onClick={() => void claim()} disabled={phase.kind === "working"}>
            {offer.label}
          </Button>
        </div>
      ) : (
        <p className={styles.muted}>Next test USDC from {offer.until.toLocaleString("en-US")}.</p>
      )}
      <ClaimStatus phase={phase} />
    </div>
  );
}

function ClaimStatus({ phase }: { phase: FaucetPhase }) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "working":
      return <Status tone="pending">sending test USDC</Status>;
    case "done":
      return (
        <Status tone="success">
          Test USDC landed in your wallet. Deposit it above.
          {phase.signature && (
            <>
              {" · "}
              <a href={solanaTxUrl(phase.signature)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </>
          )}
        </Status>
      );
    case "pending":
      return <Status tone="info">Test USDC is on its way. Refresh in a minute.</Status>;
    case "limit":
      return <Status tone="info">You already got test USDC in the last 24 h.</Status>;
    case "failed":
      return <Status tone="loss">{phase.message}</Status>;
  }
}
