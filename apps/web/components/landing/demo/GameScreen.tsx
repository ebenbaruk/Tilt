// One demo game at one moment: its table, the line under it and, at full size, its key row, as the
// mod's pane draws them. Decorative: callers put the game's description next to it in text.
import type { GameDemo } from "./types";
import styles from "./demo.module.css";

interface Props {
  game: GameDemo;
  t: number;
  /** Full shows the key row too. */
  size?: "full" | "compact";
}

export function GameScreen({ game, t, size = "full" }: Props) {
  const frame = game.frame(t);
  return (
    <div className={styles.stage} aria-hidden="true">
      <div className={`${styles.screen} ${size === "compact" ? styles.compact : ""}`}>
        <div className={styles.table}>{frame.table}</div>
        <div className={styles.line}>{frame.line}</div>
        {size === "full" && (
          <div className={styles.keys}>
            {game.keys.map(({ key, label }) => {
              const state = frame.pressed === key ? styles.keyPressed : frame.live.includes(key) ? styles.keyLive : "";
              const isSelected = frame.selected?.includes(key) && frame.pressed !== key;
              return (
                <span key={key} className={`${styles.key} ${state}`}>
                  <span className={styles.keyLetter}>{key}</span>
                  <span className={isSelected ? styles.keySelected : undefined}>{label}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
