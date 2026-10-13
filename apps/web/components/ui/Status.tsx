import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import styles from "./Status.module.css";

type Tone = "info" | "success" | "loss" | "pending";

const GLYPH: Record<Exclude<Tone, "pending">, string> = { info: "·", success: "✓", loss: "✗" };

/** One-line status message, announced to screen readers. */
export function Status({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <p className={styles[tone]} role={tone === "loss" ? "alert" : "status"}>
      {tone === "pending" ? <Spinner /> : <span aria-hidden="true">{GLYPH[tone]}</span>} {children}
    </p>
  );
}
