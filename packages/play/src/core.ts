// What a harness that loads only plain TypeScript (Node, no TSX compiler) can use: the session
// without a MotionTracker, and the one-line status. The table (./panel) and the motion (./motion)
// need the mod's view files, which are TSX: ./index adds them.
export { FRAME_MS, TiltSession } from "./session";
export { fileStore } from "./store";
export { openInBrowser } from "./open-url";
export { AGENT_SIGNAL_PATH, readAgentSignal, watchAgentSignal, writeAgentSignal } from "./signal";
export { renderStatusLine, type StatusOptions } from "./status";
export type { Auth, Command, KeyAction, Motion, Saved, SessionTally, Snapshot, Store, Tone } from "./types";
