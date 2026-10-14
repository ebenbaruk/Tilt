"use client";

import { useEffect, useRef, useState } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { getApi } from "@/lib/api";
import { createMoneyFlow, type MoneyKind, type MoneyPhase } from "@/lib/intent";

/** A deposit or withdrawal flow (see createMoneyFlow) bound to the Privy session and React state. */
export function useMoneyIntent(kind: MoneyKind, onSettled: () => void) {
  const { auth, moneyAuth } = useTiltAuth();
  const [phase, setPhase] = useState<MoneyPhase>({ kind: "idle" });
  // The flow lives as long as the panel; it reads the latest credentials and callback through this ref.
  const latest = useRef({ auth, moneyAuth, onSettled });
  useEffect(() => {
    latest.current = { auth, moneyAuth, onSettled };
  });

  const [flow] = useState(() =>
    createMoneyFlow({
      kind,
      send: async (intentId, amount) => {
        const credentials = await latest.current.moneyAuth();
        const body = { intentId, amount };
        return kind === "deposit" ? getApi().deposit(credentials, body) : getApi().withdraw(credentials, body);
      },
      fetchIntent: async (intentId) => getApi().moneyIntent(await latest.current.auth(), intentId),
      onPhase: setPhase,
      onSettled: () => latest.current.onSettled(),
      newId: () => crypto.randomUUID(),
    }),
  );

  return {
    phase,
    submit: flow.submit,
    checkAgain: flow.checkAgain,
    busy: phase.kind === "working" || phase.kind === "stillPending",
  };
}
