// The tilt mod: a game pane (or a band above the prompt) that plays against apps/api while the
// agent works. Privacy (spec §4.4, §10.6): it hooks only the session's start, the turn's start and
// end, its own command, pane and band. It never reads prompts, code, tool calls or files, and runs
// one host command, `open <login url>`.
//
// Every function that takes `$` is declared at the top of this file: the engine follows `$` only
// here, so the other modules are plain functions over data.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, RenderElement, Timer } from "claude-code";

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
import { cardCount, revealedAt } from "./blackjack";
import { cleanText, formatDuration, moveFailure, SEPARATOR } from "./format";
import { isPlayAction } from "./guards";
import {
  activeGame,
  type Command,
  currentBet,
  GAME_LABELS,
  isRoundOpen,
  nextRouletteBet,
  planKeys,
  startAction,
  stepBetIndex,
  stepHands,
} from "./keys";
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
import { isTablePost, TABLE_KEY, type TableProps } from "./table-input";
import type { Ui } from "./theme";
import { renderBand, renderPane, type Snapshot, WIDE_MIN_COLUMNS } from "./view";

const PANE = "tilt";
const PANE_TITLE = "tilt";

const auth = atom({ plugin: "tilt", key: "auth" } as const, { status: "out", message: null });
const remote = atom({ plugin: "tilt", key: "remote" } as const, { state: null, error: null, fetchedAt: 0 });
const prefs = atom({ plugin: "tilt", key: "prefs" } as const, {
  game: "blackjack",
  betIndex: 0,
  hands: 1,
  roulette: { kind: "red" },
  baccarat: "banker",
});
const intent = atom({ plugin: "tilt", key: "intent" } as const, null);
const NO_ECHO = { keys: [], until: null };
const echo = atom({ plugin: "tilt", key: "echo" } as const, NO_ECHO);
const message = atom({ plugin: "tilt", key: "message" } as const, null);
const agent = atom({ plugin: "tilt", key: "agent" } as const, { isWorking: false, frame: 0, notice: null });
const layout = atom({ plugin: "tilt", key: "layout" } as const, { paneShown: false, paneDismissed: false });
const deal = atom({ plugin: "tilt", key: "deal" } as const, { round: null, from: 0, startedAt: 0, balance: "0" });
/** Frames while cards are being turned over: under the deal step, so none is skipped. */
const DEAL_FRAME_MS = 100;

/** `$.store` keys: the mod token, and the device code of a login in progress. */
const STORE_SESSION = "session";
const STORE_DEVICE = "device";
/** The pane is open: a session that starts over (back from the agents view, a relaunch) reopens it. */
const STORE_PANE = "pane";
/** Where the surface last seated the pane, `dock` or `inline`: how the person plays. */
const STORE_PLACEMENT = "placement";

const TICK_MS = 100;
const SPINNER_FRAME_MS = 200;
const FAST_POLL_MS = 300;
const SLOW_POLL_MS = 5_000;
const RETRY_MS = 1_000;
const PANE_SYNC_MS = 2_000;
const IMPRESSION_FLUSH_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const OPEN_TIMEOUT_MS = 10_000;
/** A submitted move whose state never shows frees the keys after this long rather than never. */
const SETTLE_TIMEOUT_MS = 15_000;
/** How long a settled move's keys stay inert: a mashed key's last presses land in it. */
const ECHO_MS = 1_500;
const MS_PER_MINUTE = 60_000;

const UNTRUSTED_LOGIN_PAGE = "the login page the API sent is not on its own site.";
const INVALID_API_URL = "The tilt apiUrl setting is not a valid https url (plain http only for localhost).";
const LOGGED_OUT = "Session expired · run /tilt login again.";
const PLAYER_BUSY = "Previous move still settling.";
const UNPLAYABLE_BET = "This table's limits allow no bet · try again later.";
const ALREADY_IN = "Already logged in to tilt · run /tilt logout first to switch accounts.";

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
  /** The table's `Client` failed on this terminal: the pane draws the still table. */
  isTableBroken: boolean;
  /** The move whose POST /v1/play has no answer yet: it is not sent again meanwhile. */
  sendingId: string | null;
  /** The api answered 429: no poll or resend before this time. */
  rateLimitedUntil: number;
  /** The pane was open when the session started over: reopened once a drawing has said what the screen is. */
  isRestorePending: boolean;
  /** What the last drawing said: the fullscreen layout, where a pane docks. Null before any. */
  isFullscreen: boolean | null;
  /** Where the surface last seated the pane; null before it drew. */
  panePlacement: "dock" | "inline" | null;
  /** Cards were being turned over at the last tick: their end draws the table once more. */
  wasDealing: boolean;
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

// A 5xx message is the server's own (a stack, a query) and never one meant for the player.
const failureText = (failure: ApiFailure): string =>
  failure.kind === "network"
    ? "couldn't reach tilt"
    : failure.status !== null && failure.status >= 500
      ? "tilt is having trouble"
      : cleanText(failure.message);

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

  // A second login would stop the polls and the resend of a move in flight until it is approved,
  // and an abandoned one would read as logged out while the session still holds.
  if ((await readToken($, rt)) !== null) {
    return ALREADY_IN;
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

/** Drops the move `id` if it is still the one in flight. */
async function dropIntent($: EngineInterface, id: string): Promise<void> {
  await update($, intent, (held) => (intentView(held)?.id === id ? null : held));
}

async function settleAnswer($: EngineInterface, rt: Runtime, sent: IntentView, answer: IntentResponse): Promise<void> {
  if (answer.status === "pending") {
    await update($, intent, () => ({ ...sent, status: "pending" as const }));

    return;
  }

  rt.lastPollAt = -Infinity;
  rt.wakeAt = 0;

  if (answer.status === "submitted") {
    // The state polled until now still shows the table before the move: the keys stay off until
    // a state shows it, or a mashed key would play the old table a second time.
    const submittedAt = await $.clock.now();

    await update($, intent, () => ({ ...sent, status: "submitted" as const, submittedAt }));

    return;
  }

  await update($, intent, () => null);
  await update($, message, () => moveFailure(answer.error?.message ?? "Move failed."));
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
  const isRateLimited = failure.status === 429;
  const isTransient = failure.kind === "network" || isRateLimited || (failure.status !== null && failure.status >= 500);

  if (isRateLimited) {
    rt.rateLimitedUntil = (await $.clock.now()) + RATE_LIMIT_BACKOFF_MS;
  }

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

/** Sends, or resends with the same id, the move in flight; never while its last send has no answer. */
async function submit($: EngineInterface, rt: Runtime, sent: IntentView): Promise<void> {
  const token = await readToken($, rt);

  if (token === null || rt.base === null || rt.sendingId === sent.id) {
    return;
  }

  rt.sendingId = sent.id;
  rt.lastIntentAt = await $.clock.now();

  try {
    const answer = await play(httpOf($), rt.base, token, { intentId: sent.id, action: sent.action });

    await settleIntent($, rt, sent, answer);
  } finally {
    rt.sendingId = null;
  }
}

async function sendMove($: EngineInterface, rt: Runtime, action: PlayAction): Promise<void> {
  // A move the guards refuse (a zero stake from odd limits) would not read back as in flight, so
  // nothing would hold the next key press: it is never sent.
  if (!isPlayAction(action)) {
    await update($, message, () => UNPLAYABLE_BET);

    return;
  }

  const state = (await readRemote($)).state;
  const sent: IntentView = {
    id: crypto.randomUUID(),
    action,
    status: "sending",
    roundSeen: JSON.stringify(state?.round ?? null),
    submittedAt: null,
  };
  // Two key presses can run side by side: only the one that finds no move in flight sends.
  const held = await update($, intent, (value) => (intentView(value) === null ? sent : value));

  if (held?.id !== sent.id) {
    return;
  }

  const live =
    state === null
      ? []
      : planKeys({ state, prefs: await readPrefs($), isBusy: false })
          .filter((key) => key.command.kind !== "switch")
          .map(({ key, hotkey, label }) => ({ key, hotkey, label }));

  await update($, echo, () => ({ keys: live, until: null }));
  await update($, message, () => null);
  rt.wakeAt = 0;
  await submit($, rt, sent);
}

/**
 * Starts the echo's ECHO_MS once its move settled (the intent is gone), and clears it after. The
 * deadline lives in the store, which every load of the mod shares. Returns the ms until it is due.
 */
async function fadeEcho($: EngineInterface, now: number): Promise<number> {
  const held = await read($, echo);

  if (held.keys.length === 0 || (await readIntent($)) !== null) {
    return Infinity;
  }

  if (held.until === null) {
    await update($, echo, (value) => (value.until === null ? { ...value, until: now + ECHO_MS } : value));

    return ECHO_MS;
  }

  if (now < held.until) {
    return held.until - now;
  }

  await update($, echo, (value) => (value.until !== null && now >= value.until ? NO_ECHO : value));

  return Infinity;
}

async function intentStep($: EngineInterface, rt: Runtime, token: string, now: number): Promise<void> {
  const current = await readIntent($);

  if (current === null || rt.base === null) {
    return;
  }

  if (current.status === "submitted") {
    if (now - (current.submittedAt ?? now) >= SETTLE_TIMEOUT_MS) {
      await dropIntent($, current.id);
    }

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
    case "switch": {
      const state = (await readRemote($)).state;

      // A round in play pins its game: the press says so rather than doing nothing.
      if (isRoundOpen(state) && state?.round) {
        const game = GAME_LABELS[state.round.detail.game];

        await update($, message, () => `Finish this ${game} round before switching game.`);

        return;
      }

      await update($, message, () => null);
      await setPrefs($, (value) => ({ ...value, game: command.game }));

      return;
    }
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
    case "hands":
      await setPrefs($, (value) => ({ ...value, hands: stepHands(value.hands, command.step) }));

      return;
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

/** A key the table surface module pressed: checked, then run as that key of the plan, if it has it now. */
async function onTablePost($: EngineInterface, rt: Runtime, data: unknown): Promise<void> {
  if (!isTablePost(data)) {
    logDebug($, "ignored a malformed post from the table");

    return;
  }

  const snap = await snapshot($);
  const state = snap.remote.state;
  const action =
    state === null
      ? undefined
      : planKeys({ state, prefs: snap.prefs, isBusy: snap.intent !== null }).find((key) => key.key === data.press);

  if (action !== undefined) {
    commandRunner($, rt)(action.command);
  }
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

  // A logout, or a login as someone else, came while this was in flight: its answer is not theirs.
  if (rt.token !== token) {
    return 0;
  }

  if (!fetched.ok) {
    if (fetched.failure.status === 401) {
      await logout($, rt, LOGGED_OUT);
    } else {
      if (fetched.failure.status === 429) {
        rt.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
      }

      // The poll runs again on its own, whatever went wrong.
      await update($, remote, (value) => ({ ...value, error: `${failureText(fetched.failure)} · retrying` }));
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
    await startDeal($, held.state, fetched.value, now);
    await update($, remote, () => ({ state: fetched.value, error: null, fetchedAt: now }));
  }

  const current = await readIntent($);

  if (current?.status === "submitted" && JSON.stringify(fetched.value.round) !== current.roundSeen) {
    await dropIntent($, current.id);
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

  if (rt.isPaneOpen !== (pane !== undefined)) {
    await $.store.set(STORE_PANE, pane !== undefined);
  }

  rt.isPaneOpen = pane !== undefined;

  // Written here, not while drawing: a render may not change state.
  if (rt.panePlacement !== null && (await $.store.get(STORE_PLACEMENT)) !== rt.panePlacement) {
    await $.store.set(STORE_PLACEMENT, rt.panePlacement);
  }

  if (held.paneShown !== isShown || isClosedByPerson) {
    await update($, layout, (value: LayoutView) => ({
      paneShown: isShown,
      paneDismissed: value.paneDismissed || isClosedByPerson,
    }));
  }
}

/** New blackjack cards (a deal, a card drawn, the dealer's turn) are turned over one at a time,
 *  as the fullscreen table deals them; the balance waits for the last one. The first look at a
 *  table shows what is on it at once: that was played before. */
async function startDeal(
  $: EngineInterface,
  before: StateResponse | null,
  after: StateResponse,
  now: number,
): Promise<void> {
  const round = after.round;

  if (before === null || round === null || round.detail.game !== "blackjack") {
    return;
  }

  const isSameRound = before.round?.number === round.number && before.round.detail.game === "blackjack";
  const shown = isSameRound && before.round?.detail.game === "blackjack" ? cardCount(before.round.detail) : 0;

  if (cardCount(round.detail) > shown) {
    await update($, deal, () => ({ round: round.number, from: shown, startedAt: now, balance: before.balance }));
  }
}

/** Blackjack cards turned over so far on the table; null when none is being dealt. */
async function dealRevealed($: EngineInterface, state: StateResponse | null, now: number): Promise<number | null> {
  const playing = await read($, deal);
  const round = state?.round;

  if (round === undefined || round === null || round.detail.game !== "blackjack" || playing.round !== round.number) {
    return null;
  }

  return revealedAt(playing.from, cardCount(round.detail), now - playing.startedAt);
}

/** Moves the spinner, or a deal, while something is in motion; says how soon to draw again (null: nothing moves). */
async function animate($: EngineInterface, rt: Runtime, now: number): Promise<number | null> {
  const state = (await readRemote($)).state;
  const view = await read($, agent);
  const isDealing = (await dealRevealed($, state, now)) !== null;
  const isAnimating = isDealing || view.isWorking || needsFastPoll(state, await readIntent($));
  // The end of a deal needs one more drawing: nothing else moves then to draw the table at rest.
  const hasDealt = rt.wasDealing && !isDealing;
  const frame = hasDealt ? view.frame + 1 : Math.floor(now / (isDealing ? DEAL_FRAME_MS : SPINNER_FRAME_MS));

  rt.wasDealing = isDealing;

  if ((isAnimating || hasDealt) && frame !== view.frame) {
    await update($, agent, (value) => ({ ...value, frame }));
  }

  return isAnimating ? (isDealing ? DEAL_FRAME_MS : SPINNER_FRAME_MS) : null;
}

/** One pass of the background work; returns how long nothing needs doing. */
async function step($: EngineInterface, rt: Runtime, now: number): Promise<number> {
  const elapsed = rt.lastTickAt === null ? 0 : now - rt.lastTickAt;
  const delays: number[] = [PANE_SYNC_MS];

  rt.lastTickAt = now;

  if (rt.isRestorePending && rt.isFullscreen !== null) {
    rt.isRestorePending = false;
    await restorePane($, rt.isFullscreen);
  }

  await paneSyncStep($, rt, now);

  const frameMs = await animate($, rt, now);

  if (frameMs !== null) {
    delays.push(frameMs);
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

  if (now < rt.rateLimitedUntil) {
    delays.push(rt.rateLimitedUntil - now);
  } else {
    await intentStep($, rt, token, now);
    delays.push(await pollStep($, rt, token, now));

    // A poll that brought cards starts dealing them now, not at the next tick.
    if ((await dealRevealed($, (await readRemote($)).state, now)) !== null) {
      delays.push(DEAL_FRAME_MS);
    }
  }

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
      const wait = await step($, rt, now);

      rt.wakeAt = now + Math.min(wait, await fadeEcho($, now));
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
  const state = (await readRemote($)).state;
  const revealed = await dealRevealed($, state, await $.clock.now());

  return {
    auth: await read($, auth),
    remote: await readRemote($),
    prefs: await readPrefs($),
    intent: await readIntent($),
    echo: (await read($, echo)).keys,
    message: await read($, message),
    agent: await read($, agent),
    revealed,
    heldBalance: revealed === null ? null : (await read($, deal)).balance,
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

  if (!isInteractive) {
    return;
  }

  ensureTicker($, rt);

  // Claude Code's agents view (←, then Esc) runs the session on in a new process, where the mod
  // starts over: the pane it had comes back (restorePane), once a drawing says what the screen is.
  rt.isRestorePending = (await $.store.get(STORE_PANE)) === true && !(await read($, layout)).paneDismissed;
}

/**
 * Reopens the pane a session that started over had, without the keyboard. Back from the agents
 * view Claude Code draws the session fullscreen, where a pane docks beside the transcript: a
 * person who played with it under the transcript keeps the band above the prompt instead
 * (`/tilt` still opens the pane; played docked once, it comes back docked).
 */
async function restorePane($: EngineInterface, isFullscreen: boolean): Promise<void> {
  if (isFullscreen && (await $.store.get(STORE_PLACEMENT)) === "inline") {
    return;
  }

  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE });

  await update($, layout, (value) => ({ ...value, paneShown: opened.isPlaced }));
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
  // Remembered at once (see STORE_PANE): the agents view may be one keypress away.
  rt.lastPaneSyncAt = -Infinity;

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
    rt.lastPaneSyncAt = -Infinity;
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
    isTableBroken: false,
    sendingId: null,
    rateLimitedUntil: 0,
    isRestorePending: false,
    isFullscreen: null,
    wasDealing: false,
    panePlacement: null,
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
    rt.panePlacement = e.props.placement;
    rt.isFullscreen = e.viewport?.isFullscreen === true;
    const ui: Ui = $.ui.resolve(e);
    const pane = { bodyColumns: e.props.bodyColumns, isFocused: e.props.isFocused };
    const snap = await snapshot($);
    const state = snap.remote.state;
    let table: RenderElement | null = null;

    // The fullscreen terminal hands raw keys (Space, Enter, arrows) to a clicked `Client`; the
    // main screen never does, so there the table is drawn still and played with the letters.
    if (e.surface === "terminal" && e.viewport?.isFullscreen === true && state !== null && !rt.isTableBroken) {
      const { Client } = $.ui.resolve(e);
      const keys = planKeys({ state, prefs: snap.prefs, isBusy: snap.intent !== null });
      const props: TableProps = {
        state,
        prefs: snap.prefs,
        keys: keys.map(({ key, hotkey, label }) => ({ key, hotkey, label })),
        isWide: e.props.bodyColumns >= WIDE_MIN_COLUMNS,
        isPaneFocused: e.props.isFocused,
      };

      table = <Client key={TABLE_KEY} module="./table.tsx" props={props} />;
    }

    return renderPane(ui, snap, pane, commandRunner($, rt), table);
  });

  on("ui.message", { element: TABLE_KEY }, async ($, e) => {
    await onTablePost($, rt, e.data);

    return {};
  });

  on("ui.fault", { element: TABLE_KEY }, ($, e, next) => {
    // The engine draws the pane again: without the table's `Client` from now on, the still table instead.
    rt.isTableBroken = true;
    logDebug($, `table failed (${e.phase}): ${e.reason}`);

    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    rt.isFullscreen = e.viewport?.isFullscreen === true;

    if (rt.isRestorePending) {
      rt.wakeAt = 0;
    }

    if (e.props.hasSurvey || (await read($, layout)).paneShown) {
      return next(e);
    }

    const ui: Ui = $.ui.resolve(e);

    return renderBand(ui, await snapshot($), { bodyColumns: e.props.bodyColumns }, commandRunner($, rt));
  });
};
