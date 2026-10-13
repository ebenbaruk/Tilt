import type { ReactNode } from "react";
import styles from "./Box.module.css";

type Tone = "plain" | "brand" | "success" | "money" | "loss";

/** Flat container: 1px border, 6px radius, optional accent tint. */
export function Box({ tone = "plain", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={tone === "plain" ? styles.box : `${styles.box} ${styles[tone]}`}>
      {title && <h2 className={styles.title}>{title}</h2>}
      {children}
    </div>
  );
}
