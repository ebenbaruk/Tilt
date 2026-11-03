import { CopyButton } from "@/components/site/CopyButton";
import { INSTALL_PROMPT } from "@/lib/install-prompt";
import styles from "./InstallPrompt.module.css";

export function InstallPrompt() {
  return (
    <div className={styles.snippet}>
      <div className={styles.head}>
        <span className={styles.label}>paste into your coding agent</span>
        <CopyButton text={INSTALL_PROMPT} label="copy prompt" />
      </div>
      <pre className={styles.code} aria-label="Install prompt">
        <code>{INSTALL_PROMPT}</code>
      </pre>
    </div>
  );
}
