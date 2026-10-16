// A round as the program stores it, decoded from `PlayerAccount.round` (and the blackjack
// table) into plain TS values (see chain.ts). Everything the api shows or replays starts from this shape.
import type { BaccaratBet, RouletteBet } from "@tilt/mod/protocol";
import type { Table } from "./blackjack";
import type { Reels } from "./slots";

export type Draw = "deal" | "hit" | "double" | "split" | "dealer" | "spin" | "reveal";

export type RoundStatus = { kind: "idle" } | { kind: "awaiting"; draw: Draw } | { kind: "player_turn" };

/** The game-specific part of a round. Cards are ranks 1–13, without the program's empty slots. */
export type Outcome =
  /** `bet`: base bet of every hand, in base units (a string: details are stored as JSON). */
  | ({ game: "blackjack"; bet: string } & Table)
  | { game: "roulette"; bet: RouletteBet; number: number }
  | { game: "baccarat"; bet: BaccaratBet; player: number[]; banker: number[] }
  | { game: "slots"; reels: Reels }
  /** From the player's board. `order`: tiles revealed safe, in reveal order; `pending`: the tile
   *  awaiting its draw; `busted`: the mine that ended the round; `maxGain`: the round's cap on the
   *  gain, in base units (a string, like `bet`). */
  | {
      game: "mines";
      mines: number;
      order: number[];
      pending: number | null;
      busted: number | null;
      maxGain: string;
    };

export interface ChainRound {
  status: RoundStatus;
  /** Total stake, every blackjack hand and double included. */
  stake: bigint;
  /** What the program paid back: gross − fee. */
  payout: bigint;
  fee: bigint;
  requestId: bigint;
  outcome: Outcome;
}
