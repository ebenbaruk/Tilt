// What plays out on the table between two polled states: a round's spin, its cards turned over one
// at a time, its result a beat later and the balance held back meanwhile; and the rounds this
// session counted. Plain functions over data with no clock of their own (every call takes `now`):
// the hooks module keeps the data in its atoms, packages/play in a MotionTracker.
import type { TiltDeal, TiltResult, TiltSession, TiltSpin } from "../types";
import { dealMs, dealtCards, revealedAt } from "./cards";
import type { SlotsSpeed } from "./model";
import type { RoundView, StateResponse } from "./protocol";
import { celebrationMs, RESULT_MS, type Snapshot, spinMs, spinProgress, SURFACE_LAG_MS } from "./view";

/** The agent spinner turns a step this often. */
export const SPINNER_FRAME_MS = 200;
/** A wheel or the reels move a step every tick while they spin. */
export const SPIN_FRAME_MS = 100;

/** What the table plays out, and what this session counted. */
export interface Playing {
  spin: TiltSpin;
  deal: TiltDeal;
  result: TiltResult;
  session: TiltSession;
}

/** The spin, the deal or the result playing on the table, and the balance held back until the round shows. */
export type MotionView = Pick<Snapshot, "spinElapsed" | "revealed" | "heldBalance" | "resultElapsed">;

/** A polled state counted: what plays out next, and what the hooks module sounds. */
export interface Counted {
  playing: Playing;
  /** A new round came to the table. */
  isNew: boolean;
  /** The round this state settled and counted; null when none. */
  settled: RoundView | null;
}

/** The spinner's or the moving table's frame at `now`. */
export const frameAt = (now: number, isMoving: boolean): number =>
  Math.floor(now / (isMoving ? SPIN_FRAME_MS : SPINNER_FRAME_MS));

/** How far into its spin the round on the table is; null when no spin is playing. */
export function spinElapsed(
  spin: TiltSpin,
  state: StateResponse | null,
  now: number,
  speed: SlotsSpeed,
): number | null {
  const round = state?.round;

  if (round === undefined || round === null || spin.round !== round.number) {
    return null;
  }

  return spinProgress(round, now - spin.startedAt, speed);
}

/**
 * Blackjack, baccarat or Hilo cards turned over so far on the table; null when none is being dealt.
 * The deal lasts SURFACE_LAG_MS past its last card, the table surface module's own lag.
 */
export function dealRevealed(deal: TiltDeal, state: StateResponse | null, now: number): number | null {
  const round = state?.round;

  if (round === undefined || round === null || deal.round !== round.number) {
    return null;
  }

  const total = dealtCards(round);
  const elapsed = now - deal.startedAt;

  if (elapsed >= dealMs(deal.from, total) + SURFACE_LAG_MS) {
    return null;
  }

  return revealedAt(deal.from, total, elapsed) ?? total;
}

/** How far into its result's effects (and a win's celebration) the round on the table is; null when none plays. */
export function resultElapsed(result: TiltResult, state: StateResponse | null, now: number): number | null {
  const round = state?.round;

  if (round === undefined || round === null || result.round !== round.number) {
    return null;
  }

  const elapsed = now - result.startsAt;

  return elapsed >= 0 && elapsed < Math.max(RESULT_MS, celebrationMs(round)) ? elapsed : null;
}

/** Whether the round on the table has a result still to show: it waits for the table to catch up. */
export const isResultAhead = (result: TiltResult, state: StateResponse | null, now: number): boolean =>
  result.round !== null && result.round === state?.round?.number && now < result.startsAt;

/** The spin, the deal or the result playing on the table, and the balance held back until the round shows. */
export function motionView(playing: Playing, state: StateResponse | null, now: number, speed: SlotsSpeed): MotionView {
  const elapsed = spinElapsed(playing.spin, state, now, speed);
  const revealed = dealRevealed(playing.deal, state, now);
  const held =
    elapsed !== null
      ? playing.spin.balance
      : revealed !== null
        ? playing.deal.balance
        : isResultAhead(playing.result, state, now)
          ? playing.result.balance
          : null;

  return {
    spinElapsed: elapsed,
    revealed,
    heldBalance: held,
    resultElapsed: resultElapsed(playing.result, state, now),
  };
}

/** Whether a spin, a deal or a result is playing on the table. */
export const isMoving = (playing: Playing, state: StateResponse | null, now: number, speed: SlotsSpeed): boolean =>
  spinElapsed(playing.spin, state, now, speed) !== null ||
  dealRevealed(playing.deal, state, now) !== null ||
  isResultAhead(playing.result, state, now) ||
  resultElapsed(playing.result, state, now) !== null;

/**
 * When `round`'s result shows: after its spin lands and its last card is turned over, on the table
 * surface module too, which starts them when its props come (SURFACE_LAG_MS later).
 */
export function resultShowsAt(
  spin: TiltSpin,
  deal: TiltDeal,
  round: RoundView,
  now: number,
  speed: SlotsSpeed,
): number {
  const spinEnd = spin.round === round.number ? spin.startedAt + spinMs(round.detail, speed) : now;
  const dealEnd = deal.round === round.number ? deal.startedAt + dealMs(deal.from, dealtCards(round)) : now;

  return Math.max(now, spinEnd, dealEnd) + SURFACE_LAG_MS;
}

/**
 * A polled state `after` replaces `before` at `now`: starts the spin, the deal and the result it
 * brings, and counts a round once it settles, for the session line. A part that does not change
 * keeps its object.
 */
export function countRound(
  playing: Playing,
  before: StateResponse | null,
  after: StateResponse,
  now: number,
  speed: SlotsSpeed,
): Counted {
  const round = after.round;
  const isNew = round !== null && before !== null && round.number !== before.round?.number;
  const hasLanded =
    round !== null &&
    round.phase === "idle" &&
    before?.round?.number === round.number &&
    before.round.phase === "drawing";
  let { spin, deal, session } = playing;

  // A roulette, wheel, slots or one-draw round spins on the table while it draws, and from its
  // landing until the wheel, the last reel, the roll or the last number stops; the result shows after.
  if ((isNew || hasLanded) && round !== null && before !== null && spinMs(round.detail, speed) > 0) {
    // On a landing the balance before the spin is the one already held.
    spin = { round: round.number, startedAt: now, balance: isNew ? before.balance : spin.balance };
  }

  // New blackjack or baccarat cards (a deal, a card drawn, the dealer's turn, a draw landing) are
  // turned over one at a time, as the fullscreen table deals them; the balance waits for the last one.
  const cards = dealtCards(round);
  const shown = isNew ? 0 : dealtCards(before?.round ?? null);

  if (round !== null && before !== null && cards > shown) {
    deal = { round: round.number, from: shown, startedAt: now, balance: before.balance };
  }

  // The first look at the table: what is on it was played before this session.
  if (before === null && session.lastRound === null) {
    session = countSession(session, before, after, now);

    return { playing: { ...playing, spin, deal, session }, isNew, settled: null };
  }

  if (round === null || round.phase !== "idle" || round.number === session.lastRound) {
    return { playing: { ...playing, spin, deal }, isNew, settled: null };
  }

  session = countSession(session, before, after, now);

  // A still table (the main screen's Mines and Tower boards) plays the result as the moving one does.
  // The balance shown until then: the one held while it spun or was dealt, else the one before it settled.
  const balance =
    spin.round === round.number
      ? spin.balance
      : deal.round === round.number
        ? deal.balance
        : (before?.balance ?? after.balance);
  const result = { round: round.number, startsAt: resultShowsAt(spin, deal, round, now, speed), balance };

  return { playing: { spin, deal, result, session }, isNew, settled: round };
}

/**
 * The session line once `after` replaces `before`: the first look at the table marks what is on it
 * as played before, and a round that settles counts once. Unchanged, it keeps its object.
 */
export function countSession(
  session: TiltSession,
  before: StateResponse | null,
  after: StateResponse,
  now: number,
): TiltSession {
  const round = after.round;

  if (before === null && session.lastRound === null) {
    return round === null ? session : { ...session, lastRound: round.number };
  }

  if (round === null || round.phase !== "idle" || round.number === session.lastRound) {
    return session;
  }

  return {
    net: (BigInt(session.net) + BigInt(round.net)).toString(),
    rounds: session.rounds + 1,
    startedAt: session.startedAt ?? now,
    lastRound: round.number,
  };
}
