import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "solid" | "danger";
  /** Optional key shown in gold before the label, terminal style. */
  keyLabel?: string;
  children: ReactNode;
}

export function Button({ variant = "default", keyLabel, children, type = "button", className, ...rest }: Props) {
  return (
    <button type={type} className={`${styles[variant]} ${className ?? ""}`} {...rest}>
      {keyLabel && (
        <span className={styles.key} aria-hidden="true">
          {keyLabel}
        </span>
      )}
      {children}
    </button>
  );
}
