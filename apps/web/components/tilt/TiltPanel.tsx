import type { ReactNode } from "react";
import styles from "./TiltPanel.module.css";

interface Props {
  season?: string;
  tabs?: ReactNode;
  stats?: ReactNode;
  notice?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}

/** The pink-framed panel Tilt draws inside the agent terminal. */
export function TiltPanel({ season = "S1", tabs, stats, notice, side, children }: Props) {
  return (
    <section aria-label="Tilt panel" className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.wordmark}>TILT</span>
        <span className={styles.season}>{season}</span>
        {tabs}
        <span className={styles.spacer} />
        {stats}
      </div>
      {notice}
      <div className={side ? styles.gridWithSide : styles.grid}>
        <div className={styles.main}>{children}</div>
        {side && <aside className={styles.side}>{side}</aside>}
      </div>
    </section>
  );
}
