import { CardBuddy } from "./Illustrations";
import styles from "./Badge.module.css";

const RING = "FOR CLAUDE CODE  ·  BLACKJACK  ·  ROULETTE  ·  BACCARAT  ·  SLOTS  ·  ";

/** Round sticker: the mascot inside a slowly turning ring of text. Decorative. `text` is sized to
 *  run about once around the ring (textLength stretches it the rest of the way). */
export function Badge({ className, text = RING }: { className?: string; text?: string }) {
  return (
    <div className={`${styles.badge} ${className ?? ""}`} aria-hidden="true">
      <svg viewBox="0 0 300 300" className={styles.ring}>
        <defs>
          <path id="badge-ring" d="M150 150 m-118 0 a118 118 0 1 1 236 0 a118 118 0 1 1 -236 0" />
        </defs>
        <text className={styles.ringText} xmlSpace="preserve">
          <textPath href="#badge-ring" textLength="740">
            {text}
          </textPath>
        </text>
      </svg>
      <CardBuddy className={styles.buddy} />
    </div>
  );
}
