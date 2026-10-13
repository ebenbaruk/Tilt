import { CopyButton } from "@/components/site/CopyButton";
import styles from "./InstallSnippet.module.css";

export const INSTALL_COMMANDS = ["/plugin marketplace add ebenbaruk/Tilt", "/plugin install tilt", "/tilt login"];

export function InstallSnippet() {
  return (
    <div className={styles.snippet}>
      <div className={styles.head}>
        <span className={styles.label}>in claude code</span>
        <CopyButton text={INSTALL_COMMANDS.join("\n")} />
      </div>
      <pre className={styles.code} aria-label="Install commands">
        {INSTALL_COMMANDS.map((line) => (
          <code key={line} className={styles.line}>
            <span className={styles.chevron} aria-hidden="true">
              ›{" "}
            </span>
            {line}
            {"\n"}
          </code>
        ))}
      </pre>
    </div>
  );
}
