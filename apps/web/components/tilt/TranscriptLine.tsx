import type { ReactNode } from "react";
import styles from "./TranscriptLine.module.css";

type Props =
  | { kind: "prompt" | "meta" | "done" | "text"; children: ReactNode }
  | { kind: "tool"; name: string; arg: string; out?: string };

/** One line of the host agent's transcript, for mocks. */
export function TranscriptLine(props: Props) {
  switch (props.kind) {
    case "prompt":
      return (
        <div className={styles.prompt}>
          <span className={styles.chevron}>›</span>
          <span className={styles.strong}>{props.children}</span>
        </div>
      );
    case "meta":
      return <div className={styles.meta}>{props.children}</div>;
    case "done":
      return (
        <div>
          <span className={styles.agent}>✓</span> <span className={styles.agentText}>{props.children}</span>
        </div>
      );
    case "text":
      return (
        <div className={styles.text}>
          <span className={styles.strong}>●</span> {props.children}
        </div>
      );
    case "tool":
      return (
        <div>
          <div>
            <span className={styles.agent}>●</span> <span className={styles.tool}>{props.name}</span>
            <span className={styles.arg}>({props.arg})</span>
          </div>
          {props.out && <div className={styles.out}>└ {props.out}</div>}
        </div>
      );
  }
}
