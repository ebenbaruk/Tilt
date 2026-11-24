// Draws the table in a Bun Worker. OpenCode compiles every .tsx its process loads with OpenTUI's
// Solid transform (opentui packages/solid/scripts/solid-transform.ts), which would turn the mod's
// view (apps/mod/hooks/*.tsx) into Solid components; the runtime plugin doing it does not reach a
// Worker, where the view keeps its own JSX pragmas and draws through packages/play/src/term. The
// round's motion needs the view's timings too, so it is tracked here, from the states the session
// announces, as the session itself tracks it in a harness that loads TSX.
import type { StateResponse } from "../../apps/mod/hooks/protocol";
import { MotionTracker } from "../../packages/play/src/motion";
import { renderPanel } from "../../packages/play/src/panel";
import type { Snapshot } from "../../packages/play/src/types";

export interface PaintRequest {
  id: number;
  /** A session's snapshot without a MotionTracker: its table is still. */
  snapshot: Snapshot;
  width: number;
  rows: number;
  color: boolean;
}

export type PaintReply =
  | {
      id: number;
      lines: string[];
      /** A spin, a deal or a result plays on the table: ask for the next frame. */
      isMoving: boolean;
      /** The round playing out holds the play keys, as the drawing shows. */
      holdsPlay: boolean;
    }
  | { id: number; error: string };

/** The Worker's own scope (not a window: the DOM types name these differently). */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PaintRequest>) => void) | null;
  postMessage(reply: PaintReply): void;
};

const motion = new MotionTracker();
/** The last state the session announced, and when it fetched it. */
let seen: { state: StateResponse | null; fetchedAt: number } = { state: null, fetchedAt: 0 };

/** Observes each newly fetched state once, at its fetch time; a logout forgets the table. */
function follow({ state, fetchedAt, prefs }: Snapshot): void {
  if (state === null) {
    motion.reset();
    seen = { state: null, fetchedAt: 0 };
  } else if (fetchedAt !== seen.fetchedAt) {
    motion.observe(seen.state, state, fetchedAt, prefs.slotsSpeed);
    seen = { state, fetchedAt };
  }
}

scope.onmessage = ({ data }) => {
  const { id, snapshot, width, rows, color } = data;
  let reply: PaintReply;

  try {
    follow(snapshot);
    const table = motion.view(snapshot.state, snapshot.now, snapshot.prefs.slotsSpeed);
    const lines = renderPanel({ ...snapshot, ...table }, { color, width, rows }).slice(0, rows);

    reply = { id, lines, isMoving: table.isMoving, holdsPlay: table.holdsPlay };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }

  scope.postMessage(reply);
};
