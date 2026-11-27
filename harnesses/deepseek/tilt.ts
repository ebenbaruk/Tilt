// Tilt for DeepSeek Harness (dsh): a Cordis plugin. `agent/status` (running/idle, no content)
// drives the session's agent state and the companion's turn file; `/tilt` answers with one line,
// the balance and the last result, and the companion (harnesses/companion) draws the table: dsh
// runs plugins under plain Node, which cannot load the mod's view (.tsx).
// No prompt, reply, tool call or session event is ever read.
import { cleanText } from "../../apps/mod/hooks/format";
import {
  TiltSession,
  fileStore,
  openInBrowser,
  renderStatusLine,
  writeAgentSignal,
} from "../../packages/play/src/core";
import type { Agent, CommandResult, DshContext } from "./dsh";

export const name = "tilt";
export const inject = ["commands"];

// Command answers have no width to read: a width that fits most terminals and the web view.
const TEXT_WIDTH = 72;
const HOTKEY = /^[a-z0-9]$/;
const COMPANION = "The table: run harnesses/companion/bin/tilt in a split pane.";
const NO_API_URL = "Tilt needs TILT_API_URL (or `apiUrl` in the tilt row's config). Set it, then restart dsh.";
const USAGE = "Usage: /tilt · /tilt login · /tilt logout · /tilt <key>";

export function apply(ctx: DshContext, config: unknown): void {
  const working = followAgents(ctx);
  // Fail closed: no host is ever guessed.
  const apiUrl = configuredApiUrl(config) ?? process.env.TILT_API_URL?.trim();
  if (!apiUrl) {
    registerTilt(ctx, () => ({ kind: "error", text: NO_API_URL }));
    return;
  }

  const tilt = new TiltSession({ apiUrl, store: fileStore(), openUrl: openInBrowser });
  // The sponsor is on the companion's table, never on this line: no sponsor time counts here.
  tilt.setVisible(false);
  ctx.effect(() => {
    tilt.start();
    const stopFollowing = working.subscribe((isWorking) => tilt.setAgent(isWorking));
    return () => {
      stopFollowing();
      tilt.stop();
    };
  });
  registerTilt(ctx, (rawInput) => runCommand(tilt, working, rawInput));
}

function registerTilt(ctx: DshContext, handler: (rawInput: string) => CommandResult | Promise<CommandResult>): void {
  ctx.commands.register({
    name: "tilt",
    description: "Play Tilt while the agent works",
    input: { hint: "[login|logout|<key>]" },
    handler: ({ rawInput }) => handler(rawInput),
  });
}

async function runCommand(tilt: TiltSession, working: Working, rawInput: string): Promise<CommandResult> {
  const result = await answer(tilt, rawInput.trim().toLowerCase());
  const error = working.lastError();
  if (error === null) return result;
  const text = `${result.text ?? ""}\n(could not write ~/.tilt/agent.json: ${error})`.trim();
  return result.kind === "error" ? { kind: "error", text } : { kind: "success", text };
}

async function answer(tilt: TiltSession, word: string): Promise<CommandResult> {
  if (word === "login") return login(tilt);
  if (word === "logout") {
    await tilt.logout();
    return { kind: "success", text: "Signed out of Tilt." };
  }
  if (HOTKEY.test(word)) {
    return tilt.press(word)
      ? { kind: "success", text: `Pressed ${word}. /tilt shows the result.` }
      : { kind: "error", text: `Key ${word} is not offered now. ${COMPANION}` };
  }
  if (word !== "") return { kind: "error", text: USAGE };
  return { kind: "success", text: statusText(tilt) };
}

async function login(tilt: TiltSession): Promise<CommandResult> {
  if (tilt.snapshot().auth.status === "in") return { kind: "success", text: "Already signed in to Tilt." };
  await tilt.login();
  const { auth } = tilt.snapshot();
  if (auth.status === "pending") return { kind: "success", text: `Confirm code ${auth.userCode} at ${auth.verifyUrl}` };
  if (auth.status === "out") return { kind: "error", text: auth.message ?? "Tilt login did not start." };
  return { kind: "success", text: "Signed in to Tilt." };
}

/** The balance and the last result in one line, the session's last notice, and where the table is. */
function statusText(tilt: TiltSession): string {
  const snapshot = tilt.snapshot();
  const line = renderStatusLine(snapshot, { color: false, width: TEXT_WIDTH }).trimEnd();
  const message = snapshot.message === null ? undefined : cleanText(snapshot.message.text);
  return [line, message, COMPANION].filter((text) => text !== undefined).join("\n");
}

function configuredApiUrl(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null || !("apiUrl" in config)) return undefined;
  const { apiUrl } = config;
  return typeof apiUrl === "string" && apiUrl.trim() !== "" ? apiUrl.trim() : undefined;
}

interface Working {
  subscribe(listener: (isWorking: boolean) => void): () => void;
  lastError(): string | null;
}

/**
 * Whether any agent (the main one or a subagent) is between `running` and `idle`. Also kept in
 * ~/.tilt/agent.json, so the companion (harnesses/companion) follows dsh.
 */
function followAgents(ctx: DshContext): Working {
  const running = new Set<Agent>();
  const listeners = new Set<(isWorking: boolean) => void>();
  let isWorking = false;
  let lastError: string | null = null;

  const sync = (): void => {
    if (isWorking === running.size > 0) return;
    isWorking = running.size > 0;
    for (const listener of listeners) listener(isWorking);
    writeAgentSignal(isWorking ? "working" : "idle").then(
      () => (lastError = null),
      (error: unknown) => (lastError = error instanceof Error ? error.message : String(error)),
    );
  };

  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") running.add(agent);
    else running.delete(agent);
    sync();
  });
  ctx.on("agent/disposed", ({ agent }) => {
    running.delete(agent);
    sync();
  });
  // Unloaded mid-turn, no idle will come: leave the companion idle rather than stuck working.
  ctx.effect(() => () => {
    running.clear();
    sync();
  });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      listener(isWorking);
      return () => listeners.delete(listener);
    },
    lastError: () => lastError,
  };
}
