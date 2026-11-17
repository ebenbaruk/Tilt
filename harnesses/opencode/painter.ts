// Draws the table in a Bun Worker. OpenCode compiles every .tsx its process loads with OpenTUI's
// Solid transform (opentui packages/solid/scripts/solid-transform.ts), which would turn the mod's
// view (apps/mod/hooks/*.tsx) into Solid components; the runtime plugin doing it does not reach a
// Worker, where the view keeps its own JSX pragmas and draws through packages/play/src/term.
import { renderPanel } from "../../packages/play/src/panel";
import type { Snapshot } from "../../packages/play/src/types";

export interface PaintRequest {
  id: number;
  snapshot: Snapshot;
  width: number;
  rows: number;
}

export type PaintReply = { id: number; lines: string[] } | { id: number; error: string };

/** The Worker's own scope (not a window: the DOM types name these differently). */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PaintRequest>) => void) | null;
  postMessage(reply: PaintReply): void;
};

scope.onmessage = ({ data }) => {
  const { id, snapshot, width, rows } = data;
  let reply: PaintReply;

  try {
    reply = { id, lines: renderPanel(snapshot, { color: true, width, rows }).slice(0, rows) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }

  scope.postMessage(reply);
};
