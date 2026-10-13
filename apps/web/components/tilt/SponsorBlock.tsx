import styles from "./SponsorBlock.module.css";

interface Props {
  name: string;
  tagline?: string | null;
  /** Formatted pool, e.g. "$3,000". */
  pool: string;
  poolLabel?: string;
  endsIn?: string;
}

/** "Presented by": always labelled as sponsored, always next to the prize pool. */
export function SponsorBlock({ name, tagline, pool, poolLabel = "prize pool", endsIn }: Props) {
  return (
    <div className={styles.block}>
      <span className={styles.eyebrow}>PRESENTED BY · SPONSORED</span>
      <span className={styles.name}>{name}</span>
      {tagline && <span className={styles.tagline}>{tagline}</span>}
      <span className={styles.pool}>
        {poolLabel} <span className={styles.money}>{pool}</span>
      </span>
      {endsIn && <span className={styles.ends}>ends in {endsIn}</span>}
    </div>
  );
}
