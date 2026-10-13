"use client";

import { useEffect, useState } from "react";

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** One frame per agent tick (--tick-agent): stepped like a terminal redraw, no easing. */
const FRAME_MS = 200;

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(timer);
  }, []);
  return <span aria-hidden="true">{FRAMES[frame]}</span>;
}
