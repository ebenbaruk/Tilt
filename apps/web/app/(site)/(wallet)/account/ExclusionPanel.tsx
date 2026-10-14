"use client";

import { useState, type FormEvent } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import styles from "./account.module.css";

const PERIODS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 3650, label: "10 years" },
];

export function ExclusionPanel({ onExcluded }: { onExcluded: () => void }) {
  const { auth } = useTiltAuth();
  const [days, setDays] = useState(PERIODS[1].days);
  const [understood, setUnderstood] = useState(false);
  const [status, setStatus] = useState<{ tone: "pending" | "success" | "loss"; text: string } | null>(null);
  const label = PERIODS.find((p) => p.days === days)?.label ?? `${days} days`;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!understood) return;
    setStatus({ tone: "pending", text: "excluding" });
    try {
      await getApi().exclude(await auth(), { days });
      // Said here too: if the account refresh fails, this panel stays on screen and must not spin forever.
      setStatus({ tone: "success", text: `Self-excluded for ${label}.` });
      onExcluded();
    } catch (error) {
      setStatus({ tone: "loss", text: describeError(error) });
    }
  }

  return (
    <Box tone="loss" title="self-exclusion">
      <p>
        Take a break from Tilt. During the exclusion you can&apos;t deposit or play, and it can&apos;t be lifted early.
        You can still withdraw your balance.
      </p>
      <form onSubmit={onSubmit} className={styles.form}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.muted}>exclude me for</legend>
          <div className={styles.row}>
            {PERIODS.map((period) => (
              <label key={period.days} className={styles.radio}>
                <input
                  type="radio"
                  name="days"
                  value={period.days}
                  checked={days === period.days}
                  onChange={() => setDays(period.days)}
                />
                {period.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={styles.radio}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I understand
          this lasts {label} and can&apos;t be undone early.
        </label>
        <div className={styles.row}>
          <Button type="submit" variant="danger" disabled={!understood || (status !== null && status.tone !== "loss")}>
            self-exclude for {label}
          </Button>
        </div>
      </form>
      {status && <Status tone={status.tone}>{status.text}</Status>}
    </Box>
  );
}
