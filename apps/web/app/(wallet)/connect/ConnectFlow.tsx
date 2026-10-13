"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { approveFailure, type ApproveFailure } from "@/lib/device";
import { describeError } from "@/lib/errors";
import styles from "./connect.module.css";

type Step =
  | { kind: "idle" }
  | { kind: "approving" }
  | { kind: "approved" }
  | { kind: "failed"; reason: ApproveFailure; message: string };

export function ConnectFlow({ userCode }: { userCode: string | null }) {
  if (!userCode) {
    return (
      <Box tone="loss" title="no valid code">
        <p>
          This link doesn&apos;t carry a valid login code. Run <code>/tilt login</code> again in Claude Code and open
          the new link.
        </p>
      </Box>
    );
  }
  return (
    <div className={styles.flow}>
      <Box tone="money" title="code shown in your terminal">
        <p className={styles.code} data-testid="user-code">
          {userCode}
        </p>
        <p className={styles.muted}>Only approve if it matches the code in Claude Code exactly.</p>
      </Box>
      <Approve userCode={userCode} />
    </div>
  );
}

function Approve({ userCode }: { userCode: string }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  async function approve() {
    setStep({ kind: "approving" });
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setStep({ kind: "failed", reason: "login", message: "Your login expired. Log in again." });
        return;
      }
      await getApi().approveDevice({ accessToken }, { userCode });
      setStep({ kind: "approved" });
    } catch (error) {
      setStep({ kind: "failed", reason: approveFailure(error), message: describeError(error) });
    }
  }

  if (!ready) return <Status tone="pending">loading login</Status>;

  if (step.kind === "approved") {
    return (
      <Box tone="success" title="terminal approved">
        <Status tone="success">Back to Claude Code: the panel picks up your session in a few seconds.</Status>
        <p className={styles.muted}>You can revoke this session any time from your account page.</p>
      </Box>
    );
  }

  if (step.kind === "failed" && step.reason === "expired") {
    return (
      <Box tone="loss" title="code expired">
        <p>
          This code expired or was already used. Run <code>/tilt login</code> again in Claude Code.
        </p>
      </Box>
    );
  }

  if (!authenticated) {
    return (
      <div className={styles.actions}>
        <Button variant="solid" onClick={login}>
          log in to approve
        </Button>
        <span className={styles.muted}>email, Google, X or Phantom</span>
      </div>
    );
  }

  return (
    <div className={styles.flow}>
      <p className={styles.muted}>logged in as {accountLabel(user)}</p>
      <div className={styles.actions}>
        <Button variant="solid" keyLabel="⏎" onClick={approve} disabled={step.kind === "approving"}>
          approve this terminal
        </Button>
        <Button onClick={logout}>not you? log out</Button>
      </div>
      {step.kind === "approving" && <Status tone="pending">approving</Status>}
      {step.kind === "failed" && <Status tone="loss">{step.message}</Status>}
    </div>
  );
}

function accountLabel(user: ReturnType<typeof usePrivy>["user"]): string {
  return (
    user?.email?.address ??
    user?.google?.email ??
    (user?.twitter?.username ? `@${user.twitter.username}` : null) ??
    user?.wallet?.address ??
    "your account"
  );
}
