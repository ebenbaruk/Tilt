// What every drawing shares: the elements it draws with and the design system's colors. The pane,
// the band and the table surface module all draw from these.
import type { Elements } from "claude-code";

export type Ui = Pick<Elements["terminal"], "Box" | "Text" | "Button" | "Link">;

// The design system's oklch tokens, approximated in hex for the terminal.
export const PINK = "#f779ba";
export const GOLD = "#f1c45e";
export const GREEN = "#7ccd8e";
export const RED = "#f66d67";
export const FG1 = "#f0eee9";
export const FG4 = "#9a9aa0";
export const FG6 = "#6f7076";
export const LINE3 = "#3a3b40";
export const LINE4 = "#4a4b50";
export const FELT: Record<"red" | "black" | "green", string> = { red: "#b63132", black: "#2a2b2f", green: "#21763c" };
// A card is one row: its face on a light chip, the suit's color as ink, so a hand fits the pane's height.
export const CARD_FACE = FG1;
export const CARD_INK: Record<"red" | "black", string> = { red: "#c4302b", black: "#1b1c1f" };

/** Gains in gold, losses in red, a push in grey. */
export function toneOf(net: string): string {
  const value = BigInt(net);

  return value > 0n ? GOLD : value < 0n ? RED : FG4;
}
