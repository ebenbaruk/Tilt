"use client";

import type { AccountResponse } from "@tilt/api/public";
import { useState, type FormEvent } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { compareAmounts, formatAmount, parseAmount } from "@/lib/amount";
import { MoneyStatus } from "./MoneyStatus";
import { useMoneyIntent } from "./useMoneyIntent";
import styles from "./account.module.css";

export function WithdrawPanel({ account, onSettled }: { account: AccountResponse; onSettled: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { phase, submit, checkAgain, busy } = useMoneyIntent("withdraw", onSettled);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(input);
    if (!parsed.ok) return setError(parsed.error);
    if (compareAmounts(parsed.value, account.balance) > 0) {
      return setError(`Your Tilt balance is ${formatAmount(account.balance)} USDC.`);
    }
    setError(null);
    void submit(parsed.value);
  }

  if (!account.accountOpen) {
    return (
      <Box title="withdraw">
        <p className={styles.muted}>Nothing to withdraw yet. Your account opens with your first deposit.</p>
      </Box>
    );
  }

  return (
    <Box title="withdraw">
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
          hint={`to your wallet · ${formatAmount(account.balance)} USDC available`}
        />
        <div className={styles.row}>
          <Button type="submit" variant="solid" disabled={busy}>
            withdraw
          </Button>
          <Button onClick={() => setInput(formatAmount(account.balance).replaceAll(",", ""))} disabled={busy}>
            max
          </Button>
        </div>
      </form>
      <p className={styles.muted}>
        Paid on Solana to your own wallet. Daily caps apply; large amounts can be held for review.
      </p>
      <MoneyStatus phase={phase} doneText="Withdrawal sent to your wallet." onCheckAgain={() => void checkAgain()} />
    </Box>
  );
}
