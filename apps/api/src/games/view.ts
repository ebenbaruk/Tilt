// Builds the mod's RoundView from a decoded on-chain round. Display only: the program has
// already decided everything; totals and allowed moves mirror its rules for the UI.
import type { BaccaratView, BlackjackView, RoundPhase, RoundView, RouletteView, SlotsView } from "@tilt/mod/protocol";
import * as baccarat from "./baccarat";
import * as blackjack from "./blackjack";
import { toCards } from "./cards";
import type { Outcome, RoundStatus } from "./round";
import { glyphs } from "./slots";

export interface RoundViewInput {
  /** Player wallet (base58): seeds the cosmetic suits. */
  player: string;
  number: number;
  status: RoundStatus;
  stake: bigint;
  /** What the program paid back (gross − fee). */
  payout: bigint;
  fee: bigint;
  outcome: Outcome;
  settledSignature: string | null;
}

const PHASES: Record<RoundStatus["kind"], RoundPhase> = {
  idle: "idle",
  awaiting: "drawing",
  player_turn: "player_turn",
};

function blackjackView(
  o: Extract<Outcome, { game: "blackjack" }>,
  r: RoundViewInput,
  phase: RoundPhase,
): BlackjackView {
  const bet = BigInt(o.bet);
  const settled = phase === "idle";
  const active = phase === "player_turn" ? blackjack.activeHand(o) : undefined;
  return {
    game: "blackjack",
    hands: o.hands.map((h, i) => ({
      cards: toCards(h.cards, r.player, r.number, `hand${i}`),
      total: blackjack.total(h.cards),
      soft: blackjack.isSoft(h.cards),
      doubled: h.doubled,
      stake: blackjack.handStake(h, bet).toString(),
      result: settled ? blackjack.result(h, o.dealer, bet) : null,
    })),
    activeHand: active ? o.active : null,
    dealer: toCards(o.dealer, r.player, r.number, "dealer"),
    dealerTotal: blackjack.total(o.dealer),
    canHit: active !== undefined && blackjack.canHit(active),
    canDouble: active !== undefined && blackjack.canDouble(active),
  };
}

function baccaratView(o: Extract<Outcome, { game: "baccarat" }>, r: RoundViewInput): BaccaratView {
  return {
    game: "baccarat",
    bet: o.bet,
    player: toCards(o.player, r.player, r.number, "player"),
    banker: toCards(o.banker, r.player, r.number, "banker"),
    playerPoints: baccarat.points(o.player),
    bankerPoints: baccarat.points(o.banker),
  };
}

function detailView(r: RoundViewInput, phase: RoundPhase): RoundView["detail"] {
  const settled = phase === "idle";
  const o = r.outcome;
  switch (o.game) {
    case "blackjack":
      return blackjackView(o, r, phase);
    case "baccarat":
      return baccaratView(o, r);
    case "roulette":
      return { game: "roulette", bet: o.bet, number: settled ? o.number : null } satisfies RouletteView;
    case "slots":
      // The program leaves the reels at [0, 0, 0] until the spin lands.
      return { game: "slots", reels: settled ? glyphs(o.reels) : null } satisfies SlotsView;
  }
}

export function buildRoundView(r: RoundViewInput): RoundView {
  const phase = PHASES[r.status.kind];
  const settled = phase === "idle";
  // The protocol's payout is the gross return; the program stores it net of the fee.
  const fee = settled ? r.fee : 0n;
  const gross = settled ? r.payout + r.fee : 0n;
  return {
    phase,
    stake: r.stake.toString(),
    payout: gross.toString(),
    fee: fee.toString(),
    net: (gross - fee - r.stake).toString(),
    number: r.number,
    settledSignature: settled ? r.settledSignature : null,
    detail: detailView(r, phase),
  };
}
