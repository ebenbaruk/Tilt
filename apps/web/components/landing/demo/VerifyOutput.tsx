"use client";

// What checking a round looks like, printed line by line like a command's output.
import { useDemoClock } from "./clock";
import styles from "./VerifyOutput.module.css";

const LINES = [
  { label: "round", value: "18,204 · blackjack · 3 hands", check: "found on Solana" },
  { label: "randomness", value: "vrf 7c1e…a94f", check: "proof valid" },
  { label: "replay", value: "public program · same seed", check: "same cards" },
  { label: "payout", value: "+12.50 USDC", check: "same payout" },
];
const LINE_MS = 600;
const FIRST_LINE_MS = 500;
const LOOP_MS = 9_000;

export function VerifyOutput() {
  const { ref, elapsed } = useDemoClock<HTMLDivElement>();
  const t = elapsed === null ? LOOP_MS : elapsed % LOOP_MS;
  const shown = Math.max(0, Math.floor((t - FIRST_LINE_MS) / LINE_MS) + 1);
  const isDone = shown > LINES.length;
  return (
    <div ref={ref} className={styles.box} aria-hidden="true">
      <div className={styles.command}>
        <span className={styles.prompt}>›</span> /tilt verify 18204
      </div>
      {LINES.map((line, i) => (
        <div key={line.label} className={i < shown ? styles.line : styles.hidden}>
          <span className={styles.bullet}>●</span>
          <span className={styles.label}>{line.label}</span>
          <span className={styles.value}>{line.value}</span>
          <span className={styles.check}>✓ {line.check}</span>
        </div>
      ))}
      <div className={isDone ? styles.result : styles.hidden}>└ verified · you don&apos;t have to trust us</div>
    </div>
  );
}
