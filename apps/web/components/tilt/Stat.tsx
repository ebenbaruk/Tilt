import styles from "./Stat.module.css";

type Tone = "default" | "money" | "brand";

export function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  return (
    <span className={styles.stat}>
      {label} <span className={styles[tone]}>{value}</span>
    </span>
  );
}
