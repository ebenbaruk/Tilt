"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { DepositPanel } from "./DepositPanel";
import { ExclusionPanel } from "./ExclusionPanel";
import { LimitsPanel } from "./LimitsPanel";
import { refreshFailed, type Load } from "./load";
import { Overview } from "./Overview";
import { SessionsPanel } from "./SessionsPanel";
import { WithdrawPanel } from "./WithdrawPanel";
import styles from "./account.module.css";

/** `withdrawOnly`: the region may not play, but players can always take their money out. */
export function AccountView({ withdrawOnly = false }: { withdrawOnly?: boolean }) {
  const { ready, authenticated, login } = usePrivy();
  if (!ready) return <Status tone="pending">loading login</Status>;
  if (!authenticated) {
    return (
      <div className={styles.row}>
        <Button variant="solid" onClick={login}>
          log in
        </Button>
        <span className={styles.muted}>email, Google or X</span>
      </div>
    );
  }
  return <SignedIn withdrawOnly={withdrawOnly} />;
}

function SignedIn({ withdrawOnly }: { withdrawOnly: boolean }) {
  const { logout } = usePrivy();
  const { auth } = useTiltAuth();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const account = await getApi().account(await auth());
      setLoad({ kind: "ready", account });
    } catch (error) {
      setLoad((previous) => refreshFailed(previous, describeError(error)));
    }
  }, [auth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind === "loading") return <Status tone="pending">loading your account</Status>;
  if (load.kind === "error") {
    return (
      <Box tone="loss" title="couldn't load your account">
        <p>{load.message}</p>
        <div className={styles.row}>
          <Button onClick={() => void refresh()}>retry</Button>
          <Button onClick={logout}>log out</Button>
        </div>
      </Box>
    );
  }

  const { account } = load;
  const excluded = account.limits.excludedUntil !== null && new Date(account.limits.excludedUntil) > new Date();
  return (
    <div className={styles.stack}>
      {load.refreshError && (
        <div>
          <Status tone="loss">
            Couldn&apos;t refresh your account: {load.refreshError} The figures below may be out of date.
          </Status>
          <Button onClick={() => void refresh()}>refresh</Button>
        </div>
      )}
      <Overview account={account} onLogout={logout} />
      {excluded && (
        <Box tone="loss" title="self-excluded">
          <p>
            You are self-excluded until {new Date(account.limits.excludedUntil ?? "").toLocaleString("en-US")}. Deposits
            and play are closed until then; withdrawals stay open.
          </p>
        </Box>
      )}
      <div className={styles.grid}>
        {!excluded && !withdrawOnly && <DepositPanel account={account} onSettled={refresh} />}
        <WithdrawPanel account={account} onSettled={refresh} />
      </div>
      <SessionsPanel />
      {!withdrawOnly && <LimitsPanel limits={account.limits} onSaved={refresh} />}
      {!excluded && !withdrawOnly && <ExclusionPanel onExcluded={refresh} />}
    </div>
  );
}
