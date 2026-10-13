"use client";

import { useEffect, useState } from "react";
import styles from "./AgentCliPreview.module.css";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 200;
const LOOP_SECONDS = 50;

/** The agent's "working" line: a stepped spinner and an elapsed timer, as the design animates it.
 *  Frozen on the first frame for people who prefer reduced motion. */
export function AgentStatus() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick((t) => t + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  // Loops under a minute: a mock agent that "reads" for ten minutes looks broken.
  const seconds = 3 + (Math.floor((tick * FRAME_MS) / 1000) % LOOP_SECONDS);
  return (
    <div className={styles.status} aria-hidden="true">
      {FRAMES[tick % FRAMES.length]} Reading… <span className={styles.dim}>({seconds}s · esc to interrupt)</span>
    </div>
  );
}
