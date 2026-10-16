import { CardBuddy } from "./Illustrations";
import styles from "./Badge.module.css";

const RING = "FOR CLAUDE CODE  ·  TWELVE GAMES  ·  USDC ON SOLANA  ·  PROVABLY FAIR  ·  ";

/** Round sticker: the mascot inside a slowly turning ring of text. Decorative. */
export function Badge({ className }: { className?: string }) {
  return (
    <div className={`${styles.badge} ${className ?? ""}`} aria-hidden="true">
      <svg viewBox="0 0 300 300" className={styles.ring}>
        <defs>
          <path id="badge-ring" d="M150 150 m-118 0 a118 118 0 1 1 236 0 a118 118 0 1 1 -236 0" />
        </defs>
        <text className={styles.ringText} xmlSpace="preserve">
          <textPath href="#badge-ring" textLength="740">
            {RING}
          </textPath>
        </text>
      </svg>
      <CardBuddy className={styles.buddy} />
    </div>
  );
}
