// Tilt for GitHub Copilot CLI: a `/tilt` slash command that plays through select dialogs and
// prints one line in the timeline (the balance and the last result), while the agent's turns come
// from `assistant.turn_start` and `session.idle`. The table, and its sponsor, are the companion's
// (harnesses/companion): the CLI runs extensions under plain Node, which cannot load the mod's
// view (.tsx). The turn events are used for their timing only: no prompt, reply, tool call or
// payload is ever read.
import { cleanText } from "../../apps/mod/hooks/format";
import {
  TiltSession,
  fileStore,
  openInBrowser,
  renderStatusLine,
  writeAgentSignal,
} from "../../packages/play/src/core";
import type { Snapshot } from "../../packages/play/src/core";
import type { CopilotSession, JoinSession } from "./copilot";

// The extension runs on pipes and never learns the terminal's width: a width that fits most.
const LINE_WIDTH = 72;
// How long the play loop waits for a move to land before offering the keys again.
const MOVE_SETTLE_MS = 15_000;
const HOTKEY = /^[a-z0-9]$/;
const USAGE = "Usage: /tilt (play) · /tilt status · /tilt login · /tilt logout · /tilt <key>";
const COMPANION = "The table: run harnesses/companion/bin/tilt in a split pane.";
const NO_API_URL = "Tilt needs TILT_API_URL in the environment Copilot starts from. Set it, then run /clear.";

export async function startTilt(joinSession: JoinSession): Promise<void> {
  // Bound once joined: the command is registered at join time, the session comes back from it.
  let play: Play | null = null;
  const session = await joinSession({
    requestedEnvironmentVariables: ["TILT_API_URL"],
    commands: [
      {
        name: "tilt",
        description: "Play Tilt while Copilot works: /tilt, /tilt status, /tilt login, /tilt logout, /tilt <key>",
        handler: async ({ args }) => {
          if (play === null) return notify(session, NO_API_URL);
          await play.command(args ?? "");
        },
      },
    ],
  });

  // Fail closed: no host is ever guessed.
  const apiUrl = process.env.TILT_API_URL?.trim();
  if (!apiUrl) return;
  play = new Play(session, new TiltSession({ apiUrl, store: fileStore(), openUrl: openInBrowser }));
}

// Fields are declared, not constructor parameter properties: Node only strips erasable syntax.
class Play {
  private readonly copilot: CopilotSession;
  private readonly tilt: TiltSession;
  private isWorking = false;

  constructor(copilot: CopilotSession, tilt: TiltSession) {
    this.copilot = copilot;
    this.tilt = tilt;
    // The sponsor is on the companion's table, never in these dialogs: no sponsor time counts here.
    tilt.setVisible(false);
    tilt.start();
    this.followLogin();
    copilot.on("assistant.turn_start", () => this.setWorking(true));
    copilot.on("session.idle", () => this.setWorking(false));
    copilot.on("session.shutdown", () => {
      this.setWorking(false);
      tilt.stop();
    });
  }

  async command(args: string): Promise<void> {
    const word = args.trim().toLowerCase();
    if (word === "" || word === "play") return this.play();
    if (word === "status") return this.showStatus();
    if (word === "login") return this.login();
    if (word === "logout") return this.logout();
    if (HOTKEY.test(word)) return this.pressKey(word);
    return notify(this.copilot, USAGE);
  }

  private setWorking(isWorking: boolean): void {
    if (this.isWorking === isWorking) return;
    this.isWorking = isWorking;
    this.tilt.setAgent(isWorking);
    // The companion pane (harnesses/companion) follows the same turns through this file.
    writeAgentSignal(isWorking ? "working" : "idle").catch((error: unknown) => {
      process.stderr.write(`tilt: could not write the turn signal: ${errorText(error)}\n`);
    });
  }

  /** Picks moves from a dialog until the person cancels it. */
  private async play(): Promise<void> {
    if (!this.copilot.capabilities.ui?.elicitation) {
      await this.showStatus();
      return notify(this.copilot, "This Copilot session has no dialogs: press a key with /tilt <key>.");
    }
    for (;;) {
      const snapshot = this.tilt.snapshot();
      if (snapshot.auth.status !== "in") return notify(this.copilot, "Sign in first: /tilt login");
      const keys = snapshot.keys.filter((key) => key.hotkey !== "");
      if (keys.length === 0) {
        const message = snapshot.message === null ? "Nothing to play right now." : cleanText(snapshot.message.text);
        return notify(this.copilot, message);
      }

      const options = keys.map((key) => `${key.hotkey}  ${key.label}${key.isSelected ? " ✓" : ""}`);
      const choice = await this.copilot.ui.select(statusText(snapshot), options);
      const key = keys[options.indexOf(choice ?? "")];
      if (!key) return; // cancelled
      if (!this.tilt.press(key.hotkey)) await notify(this.copilot, "That move is not available now.");
      await settled(this.tilt);
    }
  }

  private async pressKey(hotkey: string): Promise<void> {
    if (!this.tilt.press(hotkey)) return notify(this.copilot, `Key ${hotkey} is not offered now. ${COMPANION}`);
    await settled(this.tilt);
    await this.showStatus();
  }

  private showStatus(): Promise<void> {
    return notify(this.copilot, statusText(this.tilt.snapshot()));
  }

  private async login(): Promise<void> {
    if (this.tilt.snapshot().auth.status === "in") return notify(this.copilot, "Already signed in to Tilt.");
    // The code and link, or the refusal, reach the timeline through followLogin.
    await this.tilt.login();
  }

  private async logout(): Promise<void> {
    await this.tilt.logout();
    await notify(this.copilot, "Signed out of Tilt.");
  }

  /** Tells the person each step of a device login; a token restored at start says nothing. */
  private followLogin(): void {
    let last = this.tilt.snapshot().auth;
    this.tilt.onChange(() => {
      const { auth } = this.tilt.snapshot();
      if (auth.status === last.status) return;
      const wasPending = last.status === "pending";
      last = auth;
      if (auth.status === "pending") {
        void notify(this.copilot, `Tilt login: confirm code ${auth.userCode} at ${auth.verifyUrl}`);
      } else if (wasPending && auth.status === "in") {
        void notify(this.copilot, "Signed in to Tilt. Play with /tilt.");
      } else if (auth.status === "out" && auth.message !== null) {
        void notify(this.copilot, auth.message);
      }
    });
  }
}

/** The balance and the last result in one line, the session's last notice, and where the table is. */
function statusText(snapshot: Snapshot): string {
  const line = renderStatusLine(snapshot, { color: false, width: LINE_WIDTH }).trimEnd();
  const message = snapshot.message === null ? undefined : cleanText(snapshot.message.text);
  return [line, message, COMPANION].filter((text) => text !== undefined).join("\n");
}

/** Resolves once no move is in flight, or after MOVE_SETTLE_MS so the loop never hangs. */
function settled(tilt: TiltSession): Promise<void> {
  if (!tilt.snapshot().isBusy) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, MOVE_SETTLE_MS);
    const stop = tilt.onChange(() => {
      if (!tilt.snapshot().isBusy) done();
    });
  });
}

/** The timeline is the only place to tell the person; the extension's log file is the fallback. */
function notify(copilot: CopilotSession, message: string): Promise<void> {
  return copilot.log(message).catch((error: unknown) => {
    process.stderr.write(`tilt: could not write to the timeline: ${errorText(error)}\n`);
  });
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
