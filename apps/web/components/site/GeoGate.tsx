"use client";

import Link from "next/link";
import type { GeoResponse } from "@tilt/api/public";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { getApi } from "@/lib/api";

type State = { kind: "loading" } | { kind: "error" } | { kind: "done"; geo: GeoResponse };

/** Blocks its children unless the API says the caller's region may play. Fails closed. */
export function GeoGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback((signal?: AbortSignal) => {
    setState({ kind: "loading" });
    getApi()
      .geo(signal)
      .then((geo) => setState({ kind: "done", geo }))
      .catch(() => {
        if (!signal?.aborted) setState({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [check]);

  if (state.kind === "loading") return <Status tone="pending">checking your region</Status>;
  if (state.kind === "error") {
    return (
      <Box tone="loss" title="region check failed">
        <p>Tilt couldn&apos;t confirm your region, so this page stays closed. Check your connection and retry.</p>
        <div>
          <Button onClick={() => check()}>retry</Button>
        </div>
      </Box>
    );
  }
  if (!state.geo.allowed) {
    return (
      <Box tone="loss" title="not available in your region">
        <p>
          Tilt isn&apos;t available{state.geo.country ? ` in your region (${state.geo.country})` : " in your region"}.
          Real-money games are blocked in the United States, the United Kingdom, France and other restricted
          jurisdictions.
        </p>
        <p>
          Using a VPN to get around this breaks the <Link href="/legal/terms">terms</Link> and gets accounts closed.
        </p>
      </Box>
    );
  }
  return children;
}
