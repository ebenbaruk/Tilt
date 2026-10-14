// The contract between the hooks module and the table surface module (table.tsx): the props the
// pane hands it, the raw keys it turns into key presses, and the check on what it posts back.
// The surface module only names a key of the plan; the hooks module looks it up in its own plan,
// so a post can never do more than pressing that key would.
import type { ClientKeyEvent } from "claude-code";

import type { Prefs } from "./model";
import type { StateResponse } from "./protocol";

/** The Client's key: what `ui.message` matches its posts on. */
export const TABLE_KEY = "table";

export interface TableKey {
  key: string;
  hotkey: string;
  label: string;
}

export interface TableProps {
  state: StateResponse;
  prefs: Prefs;
  /** The plan's keys right now (planKeys), the game switches included. */
  keys: TableKey[];
  isWide: boolean;
  /** The pane holds the keyboard. A click on the table then gives it the raw keys; without the
   *  pane's focus the table has none, whatever was clicked before. */
  isPaneFocused: boolean;
}

/** What the surface module posts: press the plan's key with this address. */
export interface TablePost {
  press: string;
}

/** Longer than any key address of the plan. */
const MAX_ADDRESS_LENGTH = 40;

/** `e.data` of a `ui.message` came from code: exactly `{ press: "<address>" }`, nothing else. */
export function isTablePost(data: unknown): data is TablePost {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("press" in data)) {
    return false;
  }

  const { press } = data;

  return (
    Object.keys(data).length === 1 &&
    typeof press === "string" &&
    press.length > 0 &&
    press.length <= MAX_ADDRESS_LENGTH
  );
}

const ARROWS: Record<string, string> = {
  left: "bet-down",
  right: "bet-up",
  up: "hands-up",
  down: "hands-down",
};

/**
 * The plan key a raw key presses at the table, or null. Space and Enter play: a new round with the
 * same bet and hands, or in a blackjack turn Space hits and Enter stands. The arrows step the bet
 * and the hands; any other character is the plan's own hotkey (`d` doubles, `p` splits, `1`–`4`
 * switch game).
 */
export function pressFor(event: ClientKeyEvent, keys: readonly TableKey[]): string | null {
  if (event.ctrl === true || event.meta === true) {
    return null;
  }

  const has = (address: string) => keys.some((key) => key.key === address);
  const isTurn = has("bj-stand");
  const named: Record<string, string | undefined> = {
    ...ARROWS,
    space: isTurn ? "bj-hit" : "start",
    " ": isTurn ? "bj-hit" : "start",
    return: isTurn ? "bj-stand" : "start",
  };
  const address = named[event.key] ?? keys.find((key) => key.hotkey === event.key.toLowerCase())?.key ?? null;

  return address !== null && has(address) ? address : null;
}
