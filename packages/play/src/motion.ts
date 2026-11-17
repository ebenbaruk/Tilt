// What plays out on the table between two polled states: the spin, the cards turned over one at a
// time, the result a beat later, and the balance held back meanwhile; and what this session played.
// A port of apps/mod/hooks/register.tsx (`countRound`, `spinElapsed`, `dealRevealed`,
// `resultElapsed`, `motionView`, `isMoving`) with no clock of its own: every call takes `now`.
import type { TiltSession as SessionTally } from "../../../apps/mod/types";
import { dealMs, dealtCards, revealedAt } from "../../../apps/mod/hooks/cards";
import type { SlotsSpeed } from "../../../apps/mod/hooks/model";
import type { RoundView, StateResponse } from "../../../apps/mod/hooks/protocol";
import {
  celebrationMs,
  RESULT_MS,
  type Snapshot as TableSnapshot,
  spinMs,
  spinProgress,
  SURFACE_LAG_MS,
} from "../../../apps/mod/hooks/view";

export type { SessionTally };

/** The spin, the deal or the result playing on the table, and the balance held back until the round shows. */
export type Motion = Pick<TableSnapshot, "spinElapsed" | "revealed" | "heldBalance" | "resultElapsed">;

/** The roulette, wheel, slots or one-draw round spinning, since when, and the balance before it. */
interface Spin {
  round: number | null;
  startedAt: number;
  balance: string;
}

/** Cards being turned over: `from` of them were already shown when the deal started. */
interface Deal {
  round: number | null;
  from: number;
  startedAt: number;
  balance: string;
}

/** The settled round whose result shows at `startsAt`, and the balance shown until then. */
interface Result {
  round: number | null;
  startsAt: number;
  balance: string;
}

const NO_SPIN: Spin = { round: null, startedAt: 0, balance: "0" };
const NO_DEAL: Deal = { round: null, from: 0, startedAt: 0, balance: "0" };
const NO_RESULT: Result = { round: null, startsAt: 0, balance: "0" };
const NO_TALLY: SessionTally = { net: "0", rounds: 0, startedAt: null, lastRound: null };

export class MotionTracker {
  private spin: Spin = NO_SPIN;
  private deal: Deal = NO_DEAL;
  private result: Result = NO_RESULT;
  private counted: SessionTally = NO_TALLY;

  /** What this session played: rounds settled since it first saw the table, and their net. */
  get tally(): SessionTally {
    return this.counted;
  }

  /** Forgets everything: the next account starts from its own table. */
  reset(): void {
    this.spin = NO_SPIN;
    this.deal = NO_DEAL;
    this.result = NO_RESULT;
    this.counted = NO_TALLY;
  }

  /**
   * A polled state `after` replaces `before` at `now`: starts the spin, the deal and the result it
   * brings, and counts a newly settled round. Call it before the state can be drawn, or a drawing in
   * between shows the settled round with nothing held, its balance first.
   */
  observe(before: StateResponse | null, after: StateResponse, now: number, speed: SlotsSpeed): void {
    const round = after.round;
    const isNew = round !== null && before !== null && round.number !== before.round?.number;
    const hasLanded =
      round !== null &&
      round.phase === "idle" &&
      before?.round?.number === round.number &&
      before.round.phase === "drawing";

    // A roulette, wheel, slots or one-draw round spins while it draws, and from its landing until
    // the wheel, the last reel, the roll or the last number stops; the result shows after.
    if ((isNew || hasLanded) && round !== null && before !== null && spinMs(round.detail, speed) > 0) {
      // On a landing the balance before the spin is the one already held.
      this.spin = { round: round.number, startedAt: now, balance: isNew ? before.balance : this.spin.balance };
    }

    // New cards (a deal, a card drawn, the dealer's turn, a draw landing) are turned over one at a
    // time; the balance waits for the last one.
    const cards = dealtCards(round);
    const shown = isNew ? 0 : dealtCards(before?.round ?? null);

    if (round !== null && before !== null && cards > shown) {
      this.deal = { round: round.number, from: shown, startedAt: now, balance: before.balance };
    }

    // The first look at the table: what is on it was played before this session.
    if (before === null && this.counted.lastRound === null) {
      if (round !== null) {
        this.counted = { ...this.counted, lastRound: round.number };
      }

      return;
    }

    if (round === null || round.phase !== "idle" || round.number === this.counted.lastRound) {
      return;
    }

    this.counted = {
      net: (BigInt(this.counted.net) + BigInt(round.net)).toString(),
      rounds: this.counted.rounds + 1,
      startedAt: this.counted.startedAt ?? now,
      lastRound: round.number,
    };

    // A still table (Mines, Tower) plays the result as a moving one does. The balance shown until
    // then: the one held while it spun or was dealt, else the one before it settled.
    const balance =
      this.spin.round === round.number
        ? this.spin.balance
        : this.deal.round === round.number
          ? this.deal.balance
          : (before?.balance ?? after.balance);

    this.result = { round: round.number, startsAt: this.resultShowsAt(round, now, speed), balance };
  }

  /** The spin, the deal or the result playing on `state`'s table at `now`. */
  view(state: StateResponse | null, now: number, speed: SlotsSpeed): Motion {
    const spinElapsed = this.spinElapsed(state, now, speed);
    const revealed = this.dealRevealed(state, now);
    const heldBalance =
      spinElapsed !== null
        ? this.spin.balance
        : revealed !== null
          ? this.deal.balance
          : this.isResultAhead(state, now)
            ? this.result.balance
            : null;

    return { spinElapsed, revealed, heldBalance, resultElapsed: this.resultElapsed(state, now) };
  }

  /** Whether a spin, a deal or a result is playing on `state`'s table at `now`. */
  isMoving(state: StateResponse | null, now: number, speed: SlotsSpeed): boolean {
    const motion = this.view(state, now, speed);

    return (
      motion.spinElapsed !== null ||
      motion.revealed !== null ||
      this.isResultAhead(state, now) ||
      motion.resultElapsed !== null
    );
  }

  /** How far into its spin the round on the table is; null when no spin is playing. */
  private spinElapsed(state: StateResponse | null, now: number, speed: SlotsSpeed): number | null {
    const round = state?.round ?? null;

    if (round === null || this.spin.round !== round.number) {
      return null;
    }

    return spinProgress(round, now - this.spin.startedAt, speed);
  }

  /** Cards turned over so far; null when none is being dealt. The deal lasts SURFACE_LAG_MS past its last card. */
  private dealRevealed(state: StateResponse | null, now: number): number | null {
    const round = state?.round ?? null;

    if (round === null || this.deal.round !== round.number) {
      return null;
    }

    const total = dealtCards(round);
    const elapsed = now - this.deal.startedAt;

    if (elapsed >= dealMs(this.deal.from, total) + SURFACE_LAG_MS) {
      return null;
    }

    return revealedAt(this.deal.from, total, elapsed) ?? total;
  }

  /** How far into its result's effects (and a win's celebration) the round is; null when none plays. */
  private resultElapsed(state: StateResponse | null, now: number): number | null {
    const round = state?.round ?? null;

    if (round === null || this.result.round !== round.number) {
      return null;
    }

    const elapsed = now - this.result.startsAt;

    return elapsed >= 0 && elapsed < Math.max(RESULT_MS, celebrationMs(round)) ? elapsed : null;
  }

  /** Whether the round on the table has a result still to show: it waits for the table to catch up. */
  private isResultAhead(state: StateResponse | null, now: number): boolean {
    return this.result.round !== null && this.result.round === state?.round?.number && now < this.result.startsAt;
  }

  /** When `round`'s result shows: after its spin lands and its last card is turned over, SURFACE_LAG_MS later. */
  private resultShowsAt(round: RoundView, now: number, speed: SlotsSpeed): number {
    const spinEnd = this.spin.round === round.number ? this.spin.startedAt + spinMs(round.detail, speed) : now;
    const dealEnd =
      this.deal.round === round.number ? this.deal.startedAt + dealMs(this.deal.from, dealtCards(round)) : now;

    return Math.max(now, spinEnd, dealEnd) + SURFACE_LAG_MS;
  }
}
