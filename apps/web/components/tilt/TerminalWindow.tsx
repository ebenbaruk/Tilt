import type { ReactNode } from "react";
import styles from "./TerminalWindow.module.css";

/** Stages a host agent session in mocks. Tilt never ships this inside a real terminal. */
export function TerminalWindow({ title = "~/project — agent", children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.window}>
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
