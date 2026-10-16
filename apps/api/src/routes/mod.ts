// Routes of the Claude Code mod: play-scoped session token only (spec §10.5).
import type { Hono } from "hono";
import type { IntentResponse, PlayAction } from "@tilt/mod/protocol";
import { runningCompetition } from "../competitions/store";
import type { Queryable } from "../db";
import type { AppDeps } from "../deps";
import { ApiError } from "../errors";
import { geoBlock, modAuth, parseBody, parseParam, rateLimit, type Env } from "../http";
import type { IntentOutcome } from "../intents";
import { blockReason, type Activity } from "../limits";
import { IdParam, ImpressionSchema, PlayRequestSchema } from "../schemas";
import { buildState } from "../state";
import { walletOf } from "../wallets";

/** Moves that put more money at stake: refused once a loss limit or an exclusion applies. */
const WAGERS = new Set<PlayAction["type"]>([
  "blackjack_bet",
  "blackjack_double",
  "blackjack_split",
  "roulette_spin",
  "baccarat_deal",
  "slots_spin",
  "mines_bet",
  "dice_roll",
  "limbo_play",
  "flip_play",
  "keno_play",
  "wheel_spin",
  "hilo_bet",
  "tower_bet",
]);

const toIntentResponse = (o: IntentOutcome): IntentResponse => ({
  intentId: o.intentId,
  status: o.status,
  error: o.error,
});

export function modRoutes(app: Hono<Env>, deps: AppDeps): void {
  for (const path of ["/v1/state", "/v1/play", "/v1/intents/*", "/v1/impressions"]) {
    app.use(
      path,
      modAuth(deps.db),
      rateLimit(deps.limiters.token, (c) => c.get("sessionId")),
    );
  }

  app.get("/v1/state", async (c) => c.json(await buildState(deps, c.get("userId"))));

  app.post(
    "/v1/play",
    rateLimit(deps.limiters.play, (c) => c.get("userId")),
    geoBlock(deps.geo),
    async (c) => {
      const userId = c.get("userId");
      const { intentId, action } = await parseBody(c, PlayRequestSchema);
      const wallet = await walletOf(deps.db, deps.relay, userId);
      if (!wallet) throw new ApiError("ACCOUNT_NOT_OPEN", "no account yet: deposit on the web first");
      const activity: Activity = WAGERS.has(action.type)
        ? { kind: "bet", player: wallet.toBase58() }
        : { kind: "move" };
      // Checked only for a new intent, under its insert: a retry reports what the relay did.
      const guard = async (db: Queryable) => {
        const reason = await blockReason(db, userId, activity);
        if (reason) throw new ApiError("BLOCKED", reason);
      };
      return c.json(toIntentResponse(await deps.intents.submit(userId, intentId, action, { guard })));
    },
  );

  app.get("/v1/intents/:intentId", async (c) => {
    const intentId = parseParam(c.req.param("intentId"), IdParam, "intentId");
    const outcome = await deps.intents.status(c.get("userId"), intentId);
    if (!outcome) throw new ApiError("NOT_FOUND", "unknown intent, send it again");
    return c.json(toIntentResponse(outcome));
  });

  app.post("/v1/impressions", async (c) => {
    const { sponsor, seconds } = await parseBody(c, ImpressionSchema);
    const competition = await runningCompetition(deps.db);
    if (competition?.sponsor !== sponsor) throw new ApiError("NOT_FOUND", "no running campaign for this sponsor");
    // Capped at 60 s per minute per player, whatever the mod reports.
    await deps.db.query(
      `INSERT INTO impressions (sponsor, user_id, minute, seconds) VALUES ($1, $2, date_trunc('minute', now()), $3)
       ON CONFLICT (sponsor, user_id, minute) DO UPDATE SET seconds = LEAST(60, impressions.seconds + EXCLUDED.seconds)`,
      [sponsor, c.get("userId"), seconds],
    );
    return c.body(null, 204);
  });
}
