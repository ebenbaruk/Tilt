// What plays out on the table between two polled states (apps/mod/hooks/motion.ts), kept for one
// session. Its timings come from the mod's view files (.tsx): a harness that loads only plain
// TypeScript (Node) runs its session without one, and its table stays still.
import type { TiltSession as SessionTally } from "../../../apps/mod/types";
import type { SlotsSpeed } from "../../../apps/mod/hooks/model";
import * as motion from "../../../apps/mod/hooks/motion";
import type { StateResponse } from "../../../apps/mod/hooks/protocol";
import { isPlayHeld } from "../../../apps/mod/hooks/view";

export type { SessionTally };

/** The spin, the deal or the result playing on the table, and the balance held back until the round shows. */
export type Motion = motion.MotionView;

/** What a session draws of the table's motion at one instant. */
export interface TableMotion extends Motion {
  /** What this session played: rounds settled since it first saw the table, and their net. */
  tally: SessionTally;
  /** A spin, a deal or a result plays on the table. */
  isMoving: boolean;
  /** The round playing out holds the play keys: a press would play on a table not shown yet. */
  holdsPlay: boolean;
}

const STILL: motion.Playing = {
  spin: { round: null, startedAt: 0, balance: "0" },
  deal: { round: null, from: 0, startedAt: 0, balance: "0" },
  result: { round: null, startsAt: 0, balance: "0" },
  session: { net: "0", rounds: 0, startedAt: null, lastRound: null },
};

export class MotionTracker {
  private playing = STILL;

  /** Forgets everything: the next account starts from its own table. */
  reset(): void {
    this.playing = STILL;
  }

  /**
   * A polled state `after` replaces `before` at `now`: starts the spin, the deal and the result it
   * brings, and counts a newly settled round. Call it before the state can be drawn, or a drawing in
   * between shows the settled round with nothing held, its balance first.
   */
  observe(before: StateResponse | null, after: StateResponse, now: number, speed: SlotsSpeed): void {
    this.playing = motion.countRound(this.playing, before, after, now, speed).playing;
  }

  /** The spin, the deal or the result playing on `state`'s table at `now`. */
  view(state: StateResponse | null, now: number, speed: SlotsSpeed): TableMotion {
    const shown = motion.motionView(this.playing, state, now, speed);

    return {
      ...shown,
      tally: this.playing.session,
      isMoving: motion.isMoving(this.playing, state, now, speed),
      holdsPlay: isPlayHeld({ intent: null, ...shown }),
    };
  }
}
