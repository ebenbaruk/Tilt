import type { ReactNode } from "react";
import styles from "./Page.module.css";

/** Standard page column with an eyebrow, a title and an optional lede. */
export function Page({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
      </header>
      {children}
    </div>
  );
}
