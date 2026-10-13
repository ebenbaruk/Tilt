"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const RESET_MS = 2_000;

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

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

  return (
    <Button onClick={copy} aria-live="polite">
      {state === "copied" ? "✓ copied" : state === "failed" ? "select and copy" : label}
    </Button>
  );
}
