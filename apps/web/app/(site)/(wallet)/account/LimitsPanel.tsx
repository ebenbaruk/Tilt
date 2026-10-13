"use client";

import type { ResponsibleLimits } from "@tilt/api/public";
import { useState, type FormEvent } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Status } from "@/components/ui/Status";
import { formatAmount, parseAmount } from "@/lib/amount";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import styles from "./account.module.css";

type Optional = { ok: true; value: string | null } | { ok: false; error: string };

/** Empty means "no limit". */
function parseOptional(input: string): Optional {
  if (input.trim() === "") return { ok: true, value: null };
  return parseAmount(input);
}

function initial(value: string | null): string {
  return value === null ? "" : formatAmount(value).replaceAll(",", "");
}

export function LimitsPanel({ limits, onSaved }: { limits: ResponsibleLimits; onSaved: () => void }) {
  const { auth } = useTiltAuth();
  const [deposit, setDeposit] = useState(initial(limits.dailyDeposit));
  const [loss, setLoss] = useState(initial(limits.dailyLoss));
  const [errors, setErrors] = useState<{ deposit?: string; loss?: string }>({});
  const [status, setStatus] = useState<{ tone: "pending" | "success" | "loss"; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const dailyDeposit = parseOptional(deposit);
    const dailyLoss = parseOptional(loss);
    setErrors({
      deposit: dailyDeposit.ok ? undefined : dailyDeposit.error,
      loss: dailyLoss.ok ? undefined : dailyLoss.error,
    });
    if (!dailyDeposit.ok || !dailyLoss.ok) return;
    setStatus({ tone: "pending", text: "saving" });
    try {
      await getApi().setLimits(await auth(), { dailyDeposit: dailyDeposit.value, dailyLoss: dailyLoss.value });
      setStatus({ tone: "success", text: "Saved. Lower limits apply now; higher ones after 24 hours." });
      onSaved();
    } catch (error) {
      setStatus({ tone: "loss", text: describeError(error) });
    }
  }

  return (
    <Box title="limits">
      <p className={styles.muted}>
        Rolling 24-hour caps. Leave a field empty for no limit. Lowering takes effect at once; raising waits 24 hours.
      </p>
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <div className={styles.grid}>
          <Field
            label="daily deposit limit"
            suffix="USDC"
            inputMode="decimal"
            autoComplete="off"
            placeholder="none"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            error={errors.deposit}
          />
          <Field
            label="daily loss limit"
            suffix="USDC"
            inputMode="decimal"
            autoComplete="off"
            placeholder="none"
            value={loss}
            onChange={(e) => setLoss(e.target.value)}
            error={errors.loss}
          />
        </div>
        <div className={styles.row}>
          <Button type="submit" disabled={status?.tone === "pending"}>
            save limits
          </Button>
        </div>
      </form>
      {status && <Status tone={status.tone}>{status.text}</Status>}
    </Box>
  );
}
