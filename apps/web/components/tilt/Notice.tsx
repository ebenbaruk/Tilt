import type { ReactNode } from "react";
import styles from "./Notice.module.css";

/** Full-width tinted bar under the panel header, e.g. "✓ agent finished". */
export function Notice({
  tone = "success",
  children,
  actions,
}: {
  tone?: "success" | "brand";
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles[tone]}>
      <span>{children}</span>
      <span className={styles.spacer} />
      {actions}
    </div>
  );
}
