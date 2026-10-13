import type { ReactNode } from "react";
import styles from "./KeyHint.module.css";

/** A key shortcut as the terminal panel shows it: gold key, then the action. Display only. */
export function KeyHint({ keyLabel, children }: { keyLabel: string; children: ReactNode }) {
  return (
    <span className={styles.hint}>
      <span className={styles.key}>{keyLabel}</span>
      {children}
    </span>
  );
}
