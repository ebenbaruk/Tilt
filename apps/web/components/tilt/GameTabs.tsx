import styles from "./GameTabs.module.css";

export interface GameTab {
  id: string;
  keyLabel: string;
  label: string;
}

/** Static game switcher as drawn in the terminal (the mod handles the keys). */
export function GameTabs({ tabs, active }: { tabs: GameTab[]; active: string }) {
  return (
    <span className={styles.tabs}>
      {tabs.map((tab) => (
        <span key={tab.id} className={tab.id === active ? styles.active : styles.tab}>
          [{tab.keyLabel}] {tab.label}
        </span>
      ))}
    </span>
  );
}
