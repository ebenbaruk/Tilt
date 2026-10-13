import styles from "./Leaderboard.module.css";

export interface LeaderboardRow {
  rank: number;
  handle: string;
  /** Already formatted, e.g. "+412.90". */
  net: string;
  isYou?: boolean;
}

/** Compact sidebar leaderboard, as in the terminal panel. */
export function Leaderboard({ rows, you }: { rows: LeaderboardRow[]; you?: LeaderboardRow }) {
  return (
    <div className={styles.board}>
      <span className={styles.eyebrow}>LEADERBOARD</span>
      {rows.map((row) => (
        <Row key={row.rank} row={row} />
      ))}
      {you && (
        <>
          <div className={styles.gap} aria-hidden="true">
            ⋮
          </div>
          <Row row={{ ...you, isYou: true }} />
        </>
      )}
    </div>
  );
}

function Row({ row }: { row: LeaderboardRow }) {
  return (
    <div className={row.isYou ? styles.you : styles.row}>
      <span className={styles.rank}>{row.rank}</span>
      <span className={styles.handle}>{row.isYou ? "you" : row.handle}</span>
      <span className={styles.net}>{row.net}</span>
    </div>
  );
}
