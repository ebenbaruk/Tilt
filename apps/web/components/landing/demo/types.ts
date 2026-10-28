import type { ReactNode } from "react";

export type GameId =
  | "blackjack"
  | "roulette"
  | "baccarat"
  | "slots"
  | "mines"
  | "dice"
  | "limbo"
  | "flip"
  | "keno"
  | "wheel"
  | "hilo"
  | "tower";

/** What a demo shows at one moment: its table, the line under it, and its keys. */
export interface Frame {
  table: ReactNode;
  /** The status or result line under the table, as the mod's. */
  line: ReactNode;
  /** The keys a press would do something with now; the others are drawn dim. */
  live: readonly string[];
  /** The key just pressed by the demo player, lit for a moment. */
  pressed: string | null;
  /** Choice keys set for the next round (the side backed, the risk), drawn in gold. */
  selected?: readonly string[];
}

export interface GameKey {
  key: string;
  label: string;
}

export interface GameDemo {
  id: GameId;
  name: string;
  /** Return to player before Tilt's fee, as published. */
  rtp: string;
  rule: string;
  /** The demo round in words, for people who don't see the animation. */
  about: string;
  keys: readonly GameKey[];
  /** One round, start to result, then it starts over. */
  loopMs: number;
  /** The moment shown still: before it plays, and for reduced motion. */
  stillMs: number;
  frame: (t: number) => Frame;
}
