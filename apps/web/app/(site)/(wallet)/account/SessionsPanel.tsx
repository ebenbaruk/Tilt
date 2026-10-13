"use client";

import type { ModSession } from "@tilt/api/public";
import { useCallback, useEffect, useState } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import styles from "./account.module.css";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never";
}

export function SessionsPanel() {
  const { auth } = useTiltAuth();
  const [sessions, setSessions] = useState<ModSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions((await getApi().sessions(await auth())).sessions);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await getApi().revokeSession(await auth(), id);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Box title="terminal sessions">
      <p className={styles.muted}>Each /tilt login creates one. Sessions can play, never withdraw.</p>
      {sessions === null && !error && <Status tone="pending">loading sessions</Status>}
      {sessions?.length === 0 && <p className={styles.muted}>No active sessions.</p>}
      {sessions && sessions.length > 0 && (
        <ul className={styles.list}>
          {sessions.map((session) => (
            <li key={session.id} className={styles.listItem}>
              <span>
                created {when(session.createdAt)} · last used {when(session.lastUsedAt)} · expires{" "}
                {when(session.expiresAt)}
              </span>
              <Button variant="danger" onClick={() => void revoke(session.id)} disabled={revoking !== null}>
                {revoking === session.id ? "revoking" : "revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <Status tone="loss">{error}</Status>}
    </Box>
  );
}
