"use client";

import { useEffect, useRef, useState } from "react";

/** The terminal redraws in steps, never smoothly: every demo advances one frame this often. */
export const TICK_MS = 80;

/**
 * The time a looping demo has played, in TICK_MS steps, while its element is on screen; paused
 * off screen and stopped on unmount. Null until it first plays, and for good when the person
 * prefers reduced motion: the demo then shows its still frame.
 */
export function useDemoClock<T extends Element>() {
  const ref = useRef<T>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return stop();
      timer ??= setInterval(() => setElapsed((ms) => (ms ?? 0) + TICK_MS), TICK_MS);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, []);

  return { ref, elapsed };
}
