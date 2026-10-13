"use client";

import { useAddFunds, usePrivy, useSigners, type LinkedAccountWithMetadata } from "@privy-io/react-auth";
import type { AccountResponse } from "@tilt/api/public";
import { useState, type FormEvent } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Status } from "@/components/ui/Status";
import { compareAmounts, formatAmount, parseAmount } from "@/lib/amount";
import { solanaCluster } from "@/lib/config";
import { usdcDestination } from "@/lib/solana";
import { MoneyStatus } from "./MoneyStatus";
import { useMoneyIntent } from "./useMoneyIntent";
import styles from "./account.module.css";

type WalletAccount = Extract<LinkedAccountWithMetadata, { type: "wallet" }>;

/** Validates a deposit against what the account allows; returns base units or an error. */
function checkDeposit(
  input: string,
  account: AccountResponse,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = parseAmount(input);
  if (!parsed.ok) return parsed;
  if (!account.accountOpen && compareAmounts(parsed.value, account.minFirstDeposit) < 0) {
    return { ok: false, error: `Your first deposit must be at least ${formatAmount(account.minFirstDeposit)} USDC.` };
  }
  if (compareAmounts(parsed.value, account.walletUsdc) > 0) {
    return { ok: false, error: `Your wallet holds ${formatAmount(account.walletUsdc)} USDC. Add funds first.` };
  }
  return parsed;
}

export function DepositPanel({ account, onSettled }: { account: AccountResponse; onSettled: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { phase, submit, checkAgain, busy } = useMoneyIntent("deposit", onSettled);
  const ensureSigner = useEnsureRelaySigner(account);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const checked = checkDeposit(input, account);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    void submit(checked.value, ensureSigner);
  }

  return (
    <Box title="deposit">
      {!account.accountOpen && (
        <p className={styles.note}>
          First deposit: at least <span className={styles.money}>{formatAmount(account.minFirstDeposit)} USDC</span>. A
          one-time onboarding fee of <span className={styles.money}>{formatAmount(account.onboardingFee)} USDC</span> is
          taken from it to open your on-chain account (Tilt fronts the Solana rent). Before it, you approve Tilt&apos;s
          signer on your wallet: it can sign Tilt game instructions only, never a transfer elsewhere.
        </p>
      )}
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <Field
          label="amount"
          suffix="USDC"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          error={error}
          hint={`from your wallet · ${formatAmount(account.walletUsdc)} USDC available`}
        />
        <div className={styles.row}>
          <Button type="submit" variant="solid" disabled={busy}>
            deposit
          </Button>
        </div>
      </form>
      <MoneyStatus
        phase={phase}
        doneText="Deposit landed. It counts from your next round."
        onCheckAgain={() => void checkAgain()}
      />
      <FundWallet address={account.solanaAddress} />
    </Box>
  );
}

/** Adds the relay's key quorum to the embedded wallet, scoped by the Tilt policy (spec §7), once. */
function useEnsureRelaySigner(account: AccountResponse) {
  const { user } = usePrivy();
  const { addSigners } = useSigners();
  return async () => {
    const wallet = user?.linkedAccounts.find(
      (linked): linked is WalletAccount => linked.type === "wallet" && linked.address === account.solanaAddress,
    );
    if (!wallet) throw new Error("Your Tilt wallet isn't linked to this login. Log out and in again.");
    // Privy marks a wallet `delegated` once any signer is added to it.
    if (wallet.delegated) return;
    const { signerId, policyIds } = account.privySigner;
    await addSigners({ address: wallet.address, signers: [{ signerId, policyIds }] });
  };
}

function FundWallet({ address }: { address: string }) {
  const destination = usdcDestination(solanaCluster(), address);
  const { addFunds } = useAddFunds();
  const [state, setState] = useState<"idle" | "open" | "submitted" | "closed">("idle");
  if (!destination) return null;

  async function open(target: NonNullable<typeof destination>) {
    setState("open");
    try {
      await addFunds({ destination: target, fiat: { defaultAmount: "20" } });
      setState("submitted");
    } catch {
      // addFunds rejects when the player closes the flow as well as on errors.
      setState("closed");
    }
  }

  return (
    <div className={styles.fund}>
      <p className={styles.muted}>
        No USDC yet? Buy some by card into your wallet, or send USDC on Solana to the address above.
      </p>
      <div>
        <Button onClick={() => void open(destination)} disabled={state === "open"}>
          add funds by card
        </Button>
      </div>
      {state === "submitted" && (
        <Status tone="success">Purchase sent. USDC can take a few minutes to reach your wallet.</Status>
      )}
      {state === "closed" && <Status tone="info">Card flow closed before finishing.</Status>}
    </div>
  );
}
