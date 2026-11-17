// What every Tilt client outside Claude Code shares: the session a harness drives and the table
// it draws. The game data, the keys, the checks and the drawing are the Claude Code mod's own
// modules, imported by relative path so a harness can load this folder straight from a clone
// (no install step, no node_modules), with a loader that compiles TSX (Bun).
import type { KeyAction } from "../../../apps/mod/hooks/keys";
import type { IntentView, Prefs } from "../../../apps/mod/hooks/model";
import type { StateResponse } from "../../../apps/mod/hooks/protocol";
import type { Motion, SessionTally } from "./motion";

export type { Command, KeyAction } from "../../../apps/mod/hooks/keys";
export type { IntentView, Prefs } from "../../../apps/mod/hooks/model";
export type { Game, PlayAction, RoundView, StateResponse } from "../../../apps/mod/hooks/protocol";
export type { Motion, SessionTally } from "./motion";

export type Auth =
  | { status: "out"; message: string | null }
  /** Device login started: the person confirms `userCode` at `verifyUrl` in a browser. */
  | { status: "pending"; userCode: string; verifyUrl: string }
  | { status: "in" };

export type Tone = "success" | "neutral" | "loss";

/** Everything a harness needs to draw Tilt, read at once. Shown only, never trusted. */
export interface Snapshot extends Motion {
  auth: Auth;
  /** The last good GET /v1/state; null before the first one. */
  state: StateResponse | null;
  /** One line when the last refresh failed; the last good state stays on screen. */
  error: string | null;
  /** Clock of the last good state, for the table's countdowns. */
  fetchedAt: number;
  prefs: Prefs;
  /** The move in flight; null when none is. */
  intent: IntentView | null;
  /** A move is in flight: its keys do nothing until the table shows it. */
  isBusy: boolean;
  /** The last refusal or notice, e.g. "Not enough balance." */
  message: { text: string; tone: Tone } | null;
  /** Whether the coding agent works, from the harness's turn start/end events only. */
  agent: { isWorking: boolean; notice: string | null };
  /** What this session played since it first saw the table. */
  tally: SessionTally;
  /** A spin, a deal or a result plays on the table: redraw it every frame until this is false. */
  isMoving: boolean;
  /** The keys the table offers now (apps/mod/hooks/keys.ts planKeys); none to play while a round plays out. */
  keys: KeyAction[];
  /** Deposit page on the API's own site; null when there is none to trust. */
  depositUrl: string | null;
  /** Clock of this snapshot, in ms. */
  now: number;
}

/** Where a session keeps its token and the player's table choices between runs. */
export interface Saved {
  token: string | null;
  /** The API the token was issued by: it is never sent anywhere else. */
  apiBase: string | null;
  prefs: unknown;
}

export interface Store {
  read(): Promise<Saved>;
  write(saved: Saved): Promise<void>;
}
