// `$.state` contract of the tilt mod: what its pane and band draw from. The engine requires this
// file to be self-contained, so values shaped by the api protocol (hooks/protocol.ts) are declared
// `unknown` here and checked with the guards in hooks/guards.ts on every read: any plugin can read
// this state and hook its writes, so the mod does not trust it blindly either.

export type TiltGame = "blackjack" | "roulette" | "baccarat" | "slots";

export type TiltAuth =
  | { status: "out"; message: string | null }
  | { status: "pending"; userCode: string; verifyUrl: string }
  | { status: "in" };

export type TiltRemote = {
  /** The last `StateResponse` from GET /v1/state. */
  state: unknown;
  /** One line shown when the last refresh failed; the last good state stays on screen. */
  error: string | null;
  /** `$.clock.now()` of the last refresh, so countdowns render without reading the clock. */
  fetchedAt: number;
};

export type TiltPrefs = {
  game: TiltGame;
  betIndex: number;
  /** Blackjack hands per round, 1 to 6, each at the bet. */
  hands: number;
  /** A `RouletteBet`. */
  roulette: unknown;
  baccarat: "player" | "banker" | "tie";
};

/** A move sent to the api and not settled yet; resent with the same id until it is. */
export type TiltIntent = {
  id: string;
  /** A `PlayAction`. */
  action: unknown;
  status: "sending" | "pending" | "retrying";
};

export type TiltAgent = {
  isWorking: boolean;
  frame: number;
  notice: { text: string; tone: "success" | "neutral" } | null;
};

export type TiltLayout = {
  /** The pane is placed and the one its surface shows; the band yields to it. */
  paneShown: boolean;
  /** The person closed the pane: turn starts no longer reopen it until `/tilt`. */
  paneDismissed: boolean;
};

declare module "claude-code" {
  interface PluginState {
    tilt: {
      auth: TiltAuth;
      remote: TiltRemote;
      prefs: TiltPrefs;
      intent: TiltIntent | null;
      /** Last move's error, cleared by the next move. */
      message: string | null;
      agent: TiltAgent;
      layout: TiltLayout;
    };
  }
}
