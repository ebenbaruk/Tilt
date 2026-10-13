"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { AccountResponse } from "@tilt/api/public";
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
import { Overview } from "./Overview";
import { SessionsPanel } from "./SessionsPanel";
import { WithdrawPanel } from "./WithdrawPanel";
import styles from "./account.module.css";

export function AccountView() {
  const { ready, authenticated, login } = usePrivy();
  if (!ready) return <Status tone="pending">loading login</Status>;
  if (!authenticated) {
    return (
      <div className={styles.row}>
        <Button variant="solid" onClick={login}>
          log in
        </Button>
        <span className={styles.muted}>email, Google, X or Phantom</span>
      </div>
    );
  }
  return <SignedIn />;
}

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; account: AccountResponse };

function SignedIn() {
  const { logout } = usePrivy();
  const { auth } = useTiltAuth();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const account = await getApi().account(await auth());
      setLoad({ kind: "ready", account });
    } catch (error) {
      setLoad({ kind: "error", message: describeError(error) });
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
      <Overview account={account} onLogout={logout} />
      {excluded ? (
        <Box tone="loss" title="self-excluded">
          <p>
            You are self-excluded until {new Date(account.limits.excludedUntil ?? "").toLocaleString("en-US")}. Deposits
            and play are closed until then.
          </p>
        </Box>
      ) : (
        <div className={styles.grid}>
          <DepositPanel account={account} onSettled={refresh} />
          <WithdrawPanel account={account} onSettled={refresh} />
        </div>
      )}
      <SessionsPanel />
      <LimitsPanel limits={account.limits} onSaved={refresh} />
      {!excluded && <ExclusionPanel onExcluded={refresh} />}
    </div>
  );
}
