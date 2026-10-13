"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const RESET_MS = 2_000;

type CopyState = "idle" | "copied" | "failed";

/** Copies `text` to the clipboard; the state resets to idle after a moment. */
export function useCopy(text: string): { state: CopyState; copy: () => Promise<void> } {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return { state, copy };
}

export const copyLabel = (state: CopyState, label: string) =>
  state === "copied" ? "✓ copied" : state === "failed" ? "select and copy" : label;

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const { state, copy } = useCopy(text);
  return (
    <Button onClick={copy} aria-live="polite">
      {copyLabel(state, label)}
    </Button>
  );
}
