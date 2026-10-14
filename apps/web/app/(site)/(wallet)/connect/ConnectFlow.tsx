"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { Field } from "@/components/ui/Field";
import { approveFailure, parseUserCode, stepFor, type ApproveStep } from "@/lib/device";
import { describeError } from "@/lib/errors";
import styles from "./connect.module.css";

/** The approve form: the code field belongs to it, so Enter in the field approves. */
const APPROVE_FORM = "approve-terminal";

/** The player types the code from their terminal (RFC 8628 §5.4): a code arriving in the link is
 *  never submitted, or someone could send a link that approves their own terminal in one click. */
export function ConnectFlow({ linkCode }: { linkCode: string | null }) {
  const [typed, setTyped] = useState("");
  const userCode = parseUserCode(typed);
  const malformed = typed.trim() !== "" && !userCode;
  return (
    <div className={styles.flow}>
      <Box tone="money" title="type the code shown in your terminal">
        <p className={styles.warning}>
          Only approve if you just ran <code>/tilt login</code> in your own terminal. Never enter a code someone sent
          you: it would let them play with your account.
        </p>
        <Field
          label="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          value={typed}
          form={APPROVE_FORM}
          onChange={(e) => setTyped(e.target.value)}
          error={malformed ? "That isn't a code: 8 letters and digits, like WDJB-MJHT." : null}
          hint={
            linkCode && (
              <>
                Make sure this matches your terminal: <span data-testid="link-code">{linkCode}</span>
              </>
            )
          }
        />
      </Box>
      <Approve userCode={userCode} />
    </div>
  );
}

function Approve({ userCode }: { userCode: string | null }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [sent, setSent] = useState<ApproveStep>({ kind: "idle" });
  const step = stepFor(sent, userCode);

  async function approve() {
    if (!userCode) return;
    setSent({ kind: "approving" });
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setSent({ kind: "failed", reason: "login", message: "Your login expired. Log in again.", userCode });
        return;
      }
      await getApi().approveDevice({ accessToken }, { userCode });
      setSent({ kind: "approved" });
    } catch (error) {
      setSent({ kind: "failed", reason: approveFailure(error), message: describeError(error), userCode });
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
      <Box tone="loss" title="code not accepted">
        <p>
          This code is wrong, expired or already used. Check it against your terminal, or run <code>/tilt login</code>{" "}
          again in Claude Code.
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
      <form
        id={APPROVE_FORM}
        className={styles.actions}
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        <Button type="submit" variant="solid" keyLabel="⏎" disabled={!userCode || step.kind === "approving"}>
          approve this terminal
        </Button>
        <Button onClick={logout}>not you? log out</Button>
      </form>
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
