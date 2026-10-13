// The tilt mod: a game pane (or a band above the prompt) that plays against apps/api while the
// agent works. Privacy (spec §4.4, §10.6): it hooks only the session's start, the turn's start and
// end, its own command, pane and band. It never reads prompts, code, tool calls or files, and runs
// one host command, `open <login url>`.
//
// Every function that takes `$` is declared at the top of this file: the engine follows `$` only
// here, so the other modules are plain functions over data.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, Timer } from "claude-code";

import {
  apiBase,
  type ApiFailure,
  type ApiResult,
  type Fetch,
  fetchIntent,
  fetchState,
  play,
  pollDevice,
  reportImpression,
  startDevice,
  trustedVerifyUrl,
} from "./api";
import { cleanText, formatDuration, SEPARATOR } from "./format";
import { activeGame, type Command, currentBet, nextRouletteBet, startAction, stepBetIndex } from "./keys";
import {
  type AgentView,
  type AuthView,
  intentView,
  type IntentView,
  type LayoutView,
  type Prefs,
  prefsView,
  remoteView,
  type RemoteView,
} from "./model";
import type { IntentResponse, PlayAction, StateResponse } from "./protocol";
import { renderBand, renderPane, type Snapshot, type Ui } from "./view";

const PANE = "tilt";
const PANE_TITLE = "tilt";

const auth = atom({ plugin: "tilt", key: "auth" } as const, { status: "out", message: null });
const remote = atom({ plugin: "tilt", key: "remote" } as const, { state: null, error: null, fetchedAt: 0 });
const prefs = atom({ plugin: "tilt", key: "prefs" } as const, {
  game: "blackjack",
  betIndex: 0,
  roulette: { kind: "red" },
  baccarat: "banker",
});
const intent = atom({ plugin: "tilt", key: "intent" } as const, null);
const message = atom({ plugin: "tilt", key: "message" } as const, null);
const agent = atom({ plugin: "tilt", key: "agent" } as const, { isWorking: false, frame: 0, notice: null });
const layout = atom({ plugin: "tilt", key: "layout" } as const, { paneShown: false, paneDismissed: false });

/** `$.store` keys: the mod token, and the device code of a login in progress. */
const STORE_SESSION = "session";
const STORE_DEVICE = "device";

const TICK_MS = 100;
const SPINNER_FRAME_MS = 200;
const FAST_POLL_MS = 300;
const SLOW_POLL_MS = 5_000;
const RETRY_MS = 1_000;
const PANE_SYNC_MS = 2_000;
const IMPRESSION_FLUSH_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const OPEN_TIMEOUT_MS = 10_000;
const MS_PER_MINUTE = 60_000;

const UNTRUSTED_LOGIN_PAGE = "the login page the API sent is not on its own site.";
const INVALID_API_URL = "The tilt apiUrl setting is not a valid https url (plain http only for localhost).";
const LOGGED_OUT = "Session expired · run /tilt login again.";
const PLAYER_BUSY = "Previous move still settling.";

/** Background bookkeeping of one loaded copy of the module: a reload starts it afresh. */
interface Runtime {
  base: string | null;
  ticker: Timer | null;
  isTicking: boolean;
  /** The ticker does nothing before this time; anything that needs work sooner sets it to 0. */
  wakeAt: number;
  lastTickAt: number | null;
  lastPollAt: number;
  lastIntentAt: number;
  lastPaneSyncAt: number;
  /** The pane was listed open at the last sync. */
  isPaneOpen: boolean;
  nextLoginPollAt: number;
  sponsorMs: number;
  sponsorName: string | null;
  /** undefined until read from `$.store`; null when logged out. */
  token: string | null | undefined;
}

interface StoredSession {
  token: string;
  expiresAt: string;
}

interface StoredDevice {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isStoredSession = (value: unknown): value is StoredSession =>
  isObject(value) && typeof value.token === "string" && typeof value.expiresAt === "string";

const isStoredDevice = (value: unknown): value is StoredDevice =>
  isObject(value) &&
  typeof value.deviceCode === "string" &&
  typeof value.expiresAt === "number" &&
  typeof value.intervalMs === "number";

/** "✓ agent finished in 6m 14s · your hand is saved"; interrupted or failed turns get neutral words. */
export function finishNotice(reason: string, durationMs: number): AgentView["notice"] {
  const saved = `${SEPARATOR}your hand is saved`;

  if (reason === "answer") {
    return { text: `✓ agent finished in ${formatDuration(durationMs)}${saved}`, tone: "success" };
  }

  if (reason === "aborted") {
    return { text: `agent stopped after ${formatDuration(durationMs)}${saved}`, tone: "neutral" };
  }

  return { text: `agent turn ended after ${formatDuration(durationMs)}${saved}`, tone: "neutral" };
}

const failureText = (failure: ApiFailure): string =>
  failure.kind === "network" ? "couldn't reach tilt · retrying" : cleanText(failure.message);

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const needsFastPoll = (state: StateResponse | null, current: IntentView | null): boolean =>
  current !== null || state?.round?.phase === "drawing" || state?.pendingIntentId != null;

function httpOf($: EngineInterface): Fetch {
  return (url, init) => $.http.fetch(url, init);
}

function logDebug($: EngineInterface, text: string): void {
  $.ui.log(`tilt: ${text}`, { to: "debug" });
}

async function readRemote($: EngineInterface): Promise<RemoteView> {
  return remoteView(await read($, remote));
}

async function readIntent($: EngineInterface): Promise<IntentView | null> {
  return intentView(await read($, intent));
}

async function readPrefs($: EngineInterface): Promise<Prefs> {
  return prefsView(await read($, prefs));
}

function setAuth($: EngineInterface, view: AuthView): Promise<AuthView> {
  return update($, auth, () => view);
}

// ---- session ----

async function readToken($: EngineInterface, rt: Runtime): Promise<string | null> {
  if (rt.token !== undefined) {
    return rt.token;
  }

  const stored = await $.store.get(STORE_SESSION);
  const isLive = isStoredSession(stored) && Date.parse(stored.expiresAt) > (await $.clock.now());

  rt.token = isLive ? stored.token : null;

  return rt.token;
}

async function logout($: EngineInterface, rt: Runtime, reason: string | null): Promise<void> {
  rt.token = null;
  await $.store.delete(STORE_SESSION);
  await $.store.delete(STORE_DEVICE);
  await setAuth($, { status: "out", message: reason });
  await update($, remote, () => ({ state: null, error: null, fetchedAt: 0 }));
  await update($, intent, () => null);
}

// ---- login ----

async function openBrowser($: EngineInterface, url: string): Promise<boolean> {
  try {
    const opened = await $.process.run(["open", url], { timeoutMs: OPEN_TIMEOUT_MS });

    return opened.exitCode === 0;
  } catch (error) {
    // No `open` here (not macOS, or refused): the pane shows the link and the code instead.
    logDebug($, `could not open the browser: ${errorText(error)}`);

    return false;
  }
}

async function login($: EngineInterface, rt: Runtime): Promise<string> {
  if (rt.base === null) {
    return INVALID_API_URL;
  }

  const started = await startDevice(httpOf($), rt.base);

  if (!started.ok) {
    await setAuth($, { status: "out", message: `Login failed · ${failureText(started.failure)}` });

    return `Login failed: ${failureText(started.failure)}`;
  }

  const { deviceCode, userCode, expiresIn, interval } = started.value;
  // Opened and shown only on the API's own site: a hostile or compromised API cannot send the
  // player anywhere else, nor draw escape sequences in the terminal.
  const verifyUrl = trustedVerifyUrl(started.value.verifyUrl, rt.base);

  if (verifyUrl === null) {
    await setAuth($, { status: "out", message: `Login failed · ${UNTRUSTED_LOGIN_PAGE}` });

    return `Login failed: ${UNTRUSTED_LOGIN_PAGE}`;
  }

  const now = await $.clock.now();
  const device: StoredDevice = { deviceCode, expiresAt: now + expiresIn * 1000, intervalMs: interval * 1000 };

  await $.store.set(STORE_DEVICE, device);
  rt.nextLoginPollAt = now + device.intervalMs;
  rt.wakeAt = 0;
  await setAuth($, { status: "pending", userCode, verifyUrl });
  ensureTicker($, rt);

  const code = cleanText(userCode);

  const link = cleanText(verifyUrl);

  return (await openBrowser($, verifyUrl))
    ? `Opened ${link} · confirm code ${code} there.`
    : `Open ${link} and confirm code ${code}.`;
}

async function finishLogin($: EngineInterface, rt: Runtime, session: StoredSession): Promise<void> {
  await $.store.set(STORE_SESSION, session);
  await $.store.delete(STORE_DEVICE);
  rt.token = session.token;
  rt.lastPollAt = -Infinity;
  await setAuth($, { status: "in" });
}

async function endLogin($: EngineInterface, text: string): Promise<void> {
  await $.store.delete(STORE_DEVICE);
  await setAuth($, { status: "out", message: text });
}

/** Polls the device code at the interval the api asked for; returns when to look again. */
async function loginStep($: EngineInterface, rt: Runtime, now: number): Promise<number> {
  if (now < rt.nextLoginPollAt || rt.base === null) {
    return rt.nextLoginPollAt - now;
  }

  const device = await $.store.get(STORE_DEVICE);

  if (!isStoredDevice(device) || now >= device.expiresAt) {
    await endLogin($, "Login code expired · run /tilt login again.");

    return SLOW_POLL_MS;
  }

  const polled = await pollDevice(httpOf($), rt.base, device.deviceCode);

  rt.nextLoginPollAt = now + device.intervalMs;

  if (!polled.ok) {
    if (polled.failure.status === 429) {
      await $.store.set(STORE_DEVICE, { ...device, intervalMs: device.intervalMs + RATE_LIMIT_BACKOFF_MS });
    } else if (polled.failure.kind !== "network") {
      await endLogin($, `Login failed · ${failureText(polled.failure)}`);
    }

    return device.intervalMs;
  }

  const answer = polled.value;

  if (answer.status === "approved") {
    await finishLogin($, rt, { token: answer.token, expiresAt: answer.expiresAt });

    return 0;
  }

  if (answer.status !== "pending") {
    await endLogin($, `Login ${answer.status} · run /tilt login again.`);
  }

  return device.intervalMs;
}

// ---- moves ----

async function settleAnswer($: EngineInterface, rt: Runtime, sent: IntentView, answer: IntentResponse): Promise<void> {
  if (answer.status === "pending") {
    await update($, intent, () => ({ ...sent, status: "pending" as const }));

    return;
  }

  await update($, intent, () => null);
  rt.lastPollAt = -Infinity;
  rt.wakeAt = 0;

  if (answer.status === "failed") {
    await update($, message, () => cleanText(answer.error?.message ?? "Move failed."));
  }
}

async function settleIntent(
  $: EngineInterface,
  rt: Runtime,
  sent: IntentView,
  result: ApiResult<IntentResponse>,
): Promise<void> {
  if ((await readIntent($))?.id !== sent.id) {
    return;
  }

  if (result.ok) {
    await settleAnswer($, rt, sent, result.value);

    return;
  }

  const { failure } = result;
  const isTransient = failure.kind === "network" || (failure.status !== null && failure.status >= 500);

  if (isTransient) {
    // Nothing is known about the move: it is resent later with the same id, never a new one.
    await update($, intent, () => ({ ...sent, status: "retrying" as const }));

    return;
  }

  await update($, intent, () => null);

  if (failure.status === 401) {
    await logout($, rt, LOGGED_OUT);

    return;
  }

  await update($, message, () => (failure.code === "PLAYER_BUSY" ? PLAYER_BUSY : failureText(failure)));
}

/** Sends, or resends with the same id, the move in flight. */
async function submit($: EngineInterface, rt: Runtime, sent: IntentView): Promise<void> {
  const token = await readToken($, rt);

  if (token === null || rt.base === null) {
    return;
  }

  rt.lastIntentAt = await $.clock.now();
  const answer = await play(httpOf($), rt.base, token, { intentId: sent.id, action: sent.action });

  await settleIntent($, rt, sent, answer);
}

async function sendMove($: EngineInterface, rt: Runtime, action: PlayAction): Promise<void> {
  if ((await readIntent($)) !== null) {
    return;
  }

  const sent: IntentView = { id: crypto.randomUUID(), action, status: "sending" };

  await update($, intent, () => sent);
  await update($, message, () => null);
  rt.wakeAt = 0;
  await submit($, rt, sent);
}

async function intentStep($: EngineInterface, rt: Runtime, token: string, now: number): Promise<void> {
  const current = await readIntent($);

  if (current === null || rt.base === null) {
    return;
  }

  if (current.status !== "pending") {
    if (now - rt.lastIntentAt >= RETRY_MS) {
      await submit($, rt, current);
    }

    return;
  }

  if (now - rt.lastIntentAt >= FAST_POLL_MS) {
    rt.lastIntentAt = now;
    await settleIntent($, rt, current, await fetchIntent(httpOf($), rt.base, token, current.id));
  }
}

async function setPrefs($: EngineInterface, change: (value: Prefs) => Prefs): Promise<void> {
  await update($, prefs, (held) => change(prefsView(held)));
}

async function startRound($: EngineInterface, rt: Runtime): Promise<void> {
  const state = (await readRemote($)).state;

  if (state === null) {
    return;
  }

  const chosen = await readPrefs($);
  const amount = currentBet(state.limits, chosen.betIndex);

  await sendMove($, rt, startAction(activeGame(state, chosen), amount, chosen));
}

async function runCommand($: EngineInterface, rt: Runtime, command: Command): Promise<void> {
  switch (command.kind) {
    case "switch":
      await setPrefs($, (value) => ({ ...value, game: command.game }));

      return;
    case "bet": {
      const state = (await readRemote($)).state;

      if (state === null) {
        return;
      }

      await setPrefs($, (value) => ({
        ...value,
        betIndex: stepBetIndex(state.limits, value.betIndex, command.step),
      }));

      return;
    }
    case "roulette-bet":
      await setPrefs($, (value) => ({ ...value, roulette: command.bet }));

      return;
    case "roulette-cycle":
      await setPrefs($, (value) => ({ ...value, roulette: nextRouletteBet(value.roulette, command.target) }));

      return;
    case "baccarat-bet":
      await setPrefs($, (value) => ({ ...value, baccarat: command.bet }));

      return;
    case "start":
      await startRound($, rt);

      return;
    case "play":
      await sendMove($, rt, command.action);
  }
}

/** A key press runs on its own: a failure is logged, never thrown into the surface. */
function commandRunner($: EngineInterface, rt: Runtime): (command: Command) => void {
  return (command) => {
    runCommand($, rt, command).catch((error: unknown) => logDebug($, `key failed: ${errorText(error)}`));
  };
}

// ---- background work ----

async function pollStep($: EngineInterface, rt: Runtime, token: string, now: number): Promise<number> {
  const held = await readRemote($);
  const interval = needsFastPoll(held.state, await readIntent($)) ? FAST_POLL_MS : SLOW_POLL_MS;

  if (now - rt.lastPollAt < interval || rt.base === null) {
    return interval - (now - rt.lastPollAt);
  }

  rt.lastPollAt = now;
  const fetched = await fetchState(httpOf($), rt.base, token);

  if (!fetched.ok) {
    if (fetched.failure.status === 401) {
      await logout($, rt, LOGGED_OUT);
    } else {
      await update($, remote, (value) => ({ ...value, error: failureText(fetched.failure) }));
    }

    return interval;
  }

  const minute = (ms: number) => Math.floor(ms / MS_PER_MINUTE);
  const isSame =
    held.error === null &&
    minute(held.fetchedAt) === minute(now) &&
    JSON.stringify(held.state) === JSON.stringify(fetched.value);

  // An unchanged state is not written, so the pane is not redrawn on every poll.
  if (!isSame) {
    await update($, remote, () => ({ state: fetched.value, error: null, fetchedAt: now }));
  }

  // A new session opens on the game last played.
  const lastGame = fetched.value.round?.detail.game;

  if (held.state === null && lastGame !== undefined) {
    await setPrefs($, (value) => ({ ...value, game: lastGame }));
  }

  return needsFastPoll(fetched.value, await readIntent($)) ? FAST_POLL_MS : SLOW_POLL_MS;
}

async function flushImpressions($: EngineInterface, rt: Runtime, token: string): Promise<void> {
  const seconds = Math.min(IMPRESSION_FLUSH_MS / 1000, Math.floor(rt.sponsorMs / 1000));

  rt.sponsorMs = 0;

  if (rt.sponsorName === null || seconds < 1 || rt.base === null) {
    return;
  }

  const sent = await reportImpression(httpOf($), rt.base, token, { sponsor: rt.sponsorName, seconds });

  if (!sent.ok) {
    // Impressions are best effort: a lost report is logged, never shown or retried.
    logDebug($, `impression report failed: ${sent.failure.code}`);
  }
}

/** Counts the time the sponsor block is on screen and reports it at most every 60 s. */
async function impressionStep($: EngineInterface, rt: Runtime, token: string, elapsedMs: number): Promise<void> {
  const name = (await readRemote($)).state?.sponsor?.name ?? null;

  if (name !== rt.sponsorName) {
    await flushImpressions($, rt, token);
    rt.sponsorName = name;
  }

  if (name === null) {
    return;
  }

  rt.sponsorMs += elapsedMs;

  if (rt.sponsorMs >= IMPRESSION_FLUSH_MS) {
    await flushImpressions($, rt, token);
  }
}

async function paneSyncStep($: EngineInterface, rt: Runtime, now: number): Promise<void> {
  if (now - rt.lastPaneSyncAt < PANE_SYNC_MS) {
    return;
  }

  rt.lastPaneSyncAt = now;
  const pane = (await $.ui.panes()).find((each) => each.id === PANE);
  const isShown = pane !== undefined && pane.isPlaced && pane.isShown;
  // The mod never closes its pane: one that was open and is gone, the person closed.
  const isClosedByPerson = rt.isPaneOpen && pane === undefined;
  const held = await read($, layout);

  rt.isPaneOpen = pane !== undefined;

  if (held.paneShown !== isShown || isClosedByPerson) {
    await update($, layout, (value: LayoutView) => ({
      paneShown: isShown,
      paneDismissed: value.paneDismissed || isClosedByPerson,
    }));
  }
}

/** Moves the spinner while something is in motion; says whether anything is. */
async function animate($: EngineInterface, now: number): Promise<boolean> {
  const state = (await readRemote($)).state;
  const view = await read($, agent);
  const isAnimating = view.isWorking || needsFastPoll(state, await readIntent($));
  const frame = Math.floor(now / SPINNER_FRAME_MS);

  if (isAnimating && frame !== view.frame) {
    await update($, agent, (value) => ({ ...value, frame }));
  }

  return isAnimating;
}

/** One pass of the background work; returns how long nothing needs doing. */
async function step($: EngineInterface, rt: Runtime, now: number): Promise<number> {
  const elapsed = rt.lastTickAt === null ? 0 : now - rt.lastTickAt;
  const delays: number[] = [PANE_SYNC_MS];

  rt.lastTickAt = now;
  await paneSyncStep($, rt, now);

  if (await animate($, now)) {
    delays.push(SPINNER_FRAME_MS);
  }

  const { status } = await read($, auth);

  if (status === "pending") {
    delays.push(await loginStep($, rt, now));
  }

  if (status !== "in") {
    return Math.max(0, Math.min(...delays));
  }

  const token = await readToken($, rt);

  if (token === null) {
    await logout($, rt, LOGGED_OUT);

    return 0;
  }

  await intentStep($, rt, token, now);
  delays.push(await pollStep($, rt, token, now));
  await impressionStep($, rt, token, elapsed);

  return Math.max(0, Math.min(...delays));
}

async function tick($: EngineInterface, rt: Runtime): Promise<void> {
  if (rt.isTicking) {
    return;
  }

  rt.isTicking = true;

  try {
    const now = await $.clock.now();

    if (now >= rt.wakeAt) {
      rt.wakeAt = now + (await step($, rt, now));
    }
  } catch (error) {
    logDebug($, `background step failed: ${errorText(error)}`);
  } finally {
    rt.isTicking = false;
  }
}

/** Timers die with the module, so every entry point makes sure the loop runs. */
function ensureTicker($: EngineInterface, rt: Runtime): void {
  if (rt.ticker === null) {
    rt.ticker = $.clock.every(TICK_MS, () => void tick($, rt));
  }
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  return {
    auth: await read($, auth),
    remote: await readRemote($),
    prefs: await readPrefs($),
    intent: await readIntent($),
    message: await read($, message),
    agent: await read($, agent),
  };
}

// ---- hooks ----

async function onSessionStart($: EngineInterface, rt: Runtime, isInteractive: boolean): Promise<void> {
  await $.command.register({
    name: "tilt",
    description: "Tilt: open the game pane, or `login` / `logout`",
    argumentHint: "[login|logout]",
  });

  if ((await readToken($, rt)) !== null && (await read($, auth)).status === "out") {
    await setAuth($, { status: "in" });
  }

  if (isInteractive) {
    ensureTicker($, rt);
  }
}

async function onTiltCommand($: EngineInterface, rt: Runtime, args: string): Promise<{ text: string }> {
  ensureTicker($, rt);
  const verb = args.trim();

  if (verb === "logout") {
    await logout($, rt, null);

    return { text: "Logged out of tilt." };
  }

  if (verb === "login") {
    const text = await login($, rt);
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE });

    await update($, layout, () => ({ paneShown: opened.isPlaced, paneDismissed: false }));

    return { text };
  }

  if (verb !== "") {
    return { text: "Usage: /tilt [login|logout]" };
  }

  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true });

  await update($, layout, () => ({ paneShown: opened.isPlaced, paneDismissed: false }));
  rt.wakeAt = 0;

  return { text: opened.isPlaced ? "Tilt pane opened." : "Tilt is in the band above the prompt." };
}

async function onTurnStart($: EngineInterface, rt: Runtime): Promise<void> {
  ensureTicker($, rt);
  await update($, agent, (value) => ({ ...value, isWorking: true, notice: null }));
  rt.wakeAt = 0;

  // The agent comes first: the pane opens without the keyboard, and never again once the person closed it.
  if (!(await read($, layout)).paneDismissed) {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE });

    await update($, layout, (value) => ({ ...value, paneShown: opened.isPlaced }));
  }
}

export const register: Register = (on, options) => {
  const rt: Runtime = {
    base: apiBase(options.apiUrl),
    ticker: null,
    isTicking: false,
    wakeAt: 0,
    lastTickAt: null,
    lastPollAt: -Infinity,
    lastIntentAt: -Infinity,
    lastPaneSyncAt: -Infinity,
    isPaneOpen: false,
    nextLoginPollAt: 0,
    sponsorMs: 0,
    sponsorName: null,
    token: undefined,
  };

  on("session.start", async ($, e, next) => {
    await onSessionStart($, rt, e.isInteractive);

    return next(e);
  });

  on("command.run", { command: "tilt" }, ($, e) => onTiltCommand($, rt, e.args));

  on("turn.start", async ($, e, next) => {
    await onTurnStart($, rt);

    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    // A subagent's turn is not the agent finishing.
    if (e.agentId === undefined) {
      const notice = finishNotice(e.reason, e.durationMs);

      await update($, agent, (value) => ({ ...value, isWorking: false, notice }));
    }

    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e);
    const pane = { bodyColumns: e.props.bodyColumns, isFocused: e.props.isFocused };

    return renderPane(ui, await snapshot($), pane, commandRunner($, rt));
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, layout)).paneShown) {
      return next(e);
    }

    const ui: Ui = $.ui.resolve(e);

    return renderBand(ui, await snapshot($), { bodyColumns: e.props.bodyColumns }, commandRunner($, rt));
  });
};
