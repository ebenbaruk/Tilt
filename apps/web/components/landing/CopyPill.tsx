"use client";

import { copyLabel, useCopy } from "@/components/site/CopyButton";

/** The landing's copy button: same behaviour as CopyButton, brand v2 look. */
export function CopyPill({ text, className }: { text: string; className?: string }) {
  const { state, copy } = useCopy(text);
  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {copyLabel(state, "copy")}
    </button>
  );
}
