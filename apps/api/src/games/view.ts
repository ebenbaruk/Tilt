// Builds the mod's RoundView from a decoded on-chain round. Display only: the program has
// already decided everything; totals and allowed moves mirror its rules for the UI.
import type {
  BaccaratView,
  BlackjackView,
  DiceView,
  FlipView,
  HiloGuess,
  HiloView,
  KenoView,
  LimboView,
  MinesView,
  RoundPhase,
  RoundView,
  RouletteView,
  SlotsView,
  TowerView,
  WheelView,
} from "@tilt/mod/protocol";
import * as baccarat from "./baccarat";
import * as blackjack from "./blackjack";
import { toCards } from "./cards";
import { formatFixed, HUNDREDTHS_DECIMALS, MULTIPLIER_DECIMALS } from "./decimal";
import * as dice from "./dice";
import * as flip from "./flip";
import * as hilo from "./hilo";
import * as keno from "./keno";
import * as mines from "./mines";
import type { Outcome, RoundStatus } from "./round";
import { glyphs } from "./slots";
import * as tower from "./tower";
import * as wheel from "./wheel";

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
      split: h.split,
      stake: blackjack.handStake(h, bet).toString(),
      result: settled ? blackjack.result(h, o.dealer, bet) : null,
    })),
    activeHand: active ? o.active : null,
    dealer: toCards(o.dealer, r.player, r.number, "dealer"),
    dealerTotal: blackjack.total(o.dealer),
    canHit: active !== undefined && blackjack.canHit(active),
    canDouble: active !== undefined && blackjack.canDouble(active),
    canSplit: active !== undefined && blackjack.canSplit(o),
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

/** Multipliers mirror the program's integer math (round cap included), as 4-decimal strings. */
function minesView(o: Extract<Outcome, { game: "mines" }>, r: RoundViewInput, phase: RoundPhase): MinesView {
  const gain = BigInt(o.maxGain);
  const revealed = o.order.length;
  const more = phase !== "idle" && mines.canRevealMore(r.stake, o.mines, revealed, gain);
  const turn = phase === "player_turn";
  return {
    game: "mines",
    mines: o.mines,
    revealed: o.order,
    pending: o.pending,
    busted: o.busted,
    multiplier: mines.formatMultiplier(mines.scaledMultiplier(r.stake, o.mines, revealed, gain)),
    nextMultiplier: more ? mines.formatMultiplier(mines.scaledMultiplier(r.stake, o.mines, revealed + 1, gain)) : null,
    canCashOut: turn && revealed >= 1,
    canReveal: turn && more,
  };
}

/** Same as mines: the program's integer math, round cap included. */
function towerView(o: Extract<Outcome, { game: "tower" }>, r: RoundViewInput, phase: RoundPhase): TowerView {
  const gain = BigInt(o.maxGain);
  const levels = o.climbed.length;
  const more = phase !== "idle" && tower.canClimbMore(r.stake, o.difficulty, levels, gain);
  const turn = phase === "player_turn";
  const multiplier = (l: number) =>
    formatFixed(tower.scaledMultiplier(r.stake, o.difficulty, l, gain), MULTIPLIER_DECIMALS);
  return {
    game: "tower",
    difficulty: o.difficulty,
    tiles: tower.DIFFICULTIES[o.difficulty].tiles,
    levels: tower.LEVELS,
    climbed: o.climbed,
    pending: o.pending,
    busted: o.busted,
    multiplier: multiplier(levels),
    nextMultiplier: more ? multiplier(levels + 1) : null,
    canClimb: turn && more,
    canCashOut: turn && levels >= 1,
  };
}

/** The fair multiplier replayed from the board's cards and guesses; shown ×0.98, capped. */
function hiloView(o: Extract<Outcome, { game: "hilo" }>, r: RoundViewInput, phase: RoundPhase): HiloView {
  const gain = BigInt(o.maxGain);
  const played = hilo.play(r.stake, gain, o.cards, o.guesses);
  if (!played) throw new Error("hilo board with guesses the rules refuse");
  const last = o.cards.at(-1);
  const inPlay = phase === "player_turn" && last !== undefined && o.pending === null && !o.busted;
  const multiplier = (fair: bigint) => formatFixed(hilo.scaledMultiplier(r.stake, fair, gain), MULTIPLIER_DECIMALS);
  /** The multiplier after a right `guess`, null when the program would refuse it. */
  const after = (guess: HiloGuess) => {
    const winning = last === undefined ? null : hilo.winningRanks(guess, hilo.rank(last));
    return inPlay && winning !== null && winning < hilo.RANKS ? multiplier(hilo.nextFair(played.fair, winning)) : null;
  };
  return {
    game: "hilo",
    cards: o.cards.map(hilo.toCard),
    guesses: o.guesses,
    pending: o.pending,
    multiplier: multiplier(played.fair),
    higherMultiplier: after("higher"),
    lowerMultiplier: after("lower"),
    skipsLeft: hilo.MAX_SKIPS - played.skips,
    canGuess: inPlay,
    canCashOut: inPlay && played.right >= 1,
    busted: o.busted,
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
    case "dice":
      return {
        game: "dice",
        target: o.target,
        over: o.over,
        roll: settled ? o.roll : null,
        multiplier: formatFixed(dice.scaledMultiplier(o.target, o.over), MULTIPLIER_DECIMALS),
      } satisfies DiceView;
    case "limbo":
      return {
        game: "limbo",
        target: formatFixed(BigInt(o.target), HUNDREDTHS_DECIMALS),
        result: settled ? formatFixed(BigInt(o.result), HUNDREDTHS_DECIMALS) : null,
      } satisfies LimboView;
    case "flip":
      return {
        game: "flip",
        side: o.side,
        flips: o.flips,
        results: settled ? o.results : null,
        multiplier: formatFixed(flip.scaledMultiplier(o.flips), MULTIPLIER_DECIMALS),
      } satisfies FlipView;
    case "keno":
      return {
        game: "keno",
        picks: o.picks,
        drawn: settled ? o.drawn : null,
        hits: settled ? keno.hits(o.picks, o.drawn) : null,
        paytable: keno.paytable(o.picks.length).map((m) => formatFixed(m, HUNDREDTHS_DECIMALS)),
      } satisfies KenoView;
    case "wheel":
      return {
        game: "wheel",
        segments: o.segments,
        risk: o.risk,
        multipliers: wheel.multipliers(o.risk, o.segments).map((m) => formatFixed(m, HUNDREDTHS_DECIMALS)),
        segment: settled ? o.segment : null,
      } satisfies WheelView;
    case "hilo":
      return hiloView(o, r, phase);
    case "mines":
      return minesView(o, r, phase);
    case "tower":
      return towerView(o, r, phase);
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
