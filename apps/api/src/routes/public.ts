// Public routes: health, leaderboard, provably-fair verification and the geo check.
import { PublicKey } from "@solana/web3.js";
import { playerAccountAddress } from "@tilt/contract";
import type { Game } from "@tilt/mod/protocol";
import type { Hono } from "hono";
import { latestCompetition, sponsorView } from "../competitions/store";
import type { AppDeps } from "../deps";
import { ApiError } from "../errors";
import { replay } from "../games/replay";
import { buildRoundView } from "../games/view";
import { country, geoAllowed, parseParam, type Env } from "../http";
import type { GeoResponse, LeaderboardResponse, VerifyResponse } from "../public";
import { drawsBetween, findRound, isCashout, previousRequestId, type IndexedRound } from "../rounds";
import { SignatureParam } from "../schemas";
import { leaderboard } from "../state";

/** Games whose rounds take several draws (one per card or per tile). */
const MULTI_DRAW: ReadonlySet<Game> = new Set(["blackjack", "mines"]);

/** VRF outputs of a round in request order. Blackjack and mines need every draw since the
 *  previous round settled; without that bound (previous round not indexed) only the last one is
 *  known. A mines cash-out settles without a draw (zero randomness in the event): its last draw
 *  is the last reveal's. */
async function roundDraws(deps: AppDeps, round: IndexedRound): Promise<{ draws: Buffer[]; complete: boolean }> {
  const settledByDraw = !isCashout(round);
  if (!MULTI_DRAW.has(round.game)) return { draws: [round.randomness], complete: true };
  const after = await previousRequestId(deps.db, round.player, round.round);
  if (after === null) return { draws: settledByDraw ? [round.randomness] : [], complete: false };
  const account = playerAccountAddress(new PublicKey(round.player)).toBase58();
  const draws = await drawsBetween(deps.db, account, after, round.requestId);
  const last = draws.at(-1);
  if (settledByDraw && !last?.equals(round.randomness)) draws.push(round.randomness);
  return { draws, complete: true };
}

async function verify(deps: AppDeps, signature: string): Promise<VerifyResponse> {
  const round = await findRound(deps.db, signature);
  if (!round) throw new ApiError("NOT_FOUND", "round not indexed (yet)");
  const { draws, complete } = await roundDraws(deps, round);
  if (draws.length === 0) throw new ApiError("NOT_FOUND", "round draws not indexed (yet)");
  const result = replay({
    game: round.game,
    stake: round.stake,
    onChain: { payout: round.payout, fee: round.fee },
    draws,
    snapshot: round.detail,
  });
  return {
    signature,
    player: round.player,
    round: round.round,
    game: round.game,
    randomness: round.randomness.toString("hex"),
    replayed: buildRoundView({
      player: round.player,
      number: round.round,
      status: { kind: "idle" },
      stake: round.stake,
      payout: result.settlement.payout,
      fee: result.settlement.fee,
      outcome: result.outcome,
      settledSignature: signature,
    }),
    // Gross payout, like RoundView.payout, so both sides compare directly.
    onChain: {
      stake: round.stake.toString(),
      payout: (round.payout + round.fee).toString(),
      fee: round.fee.toString(),
    },
    matches: result.matches && complete,
  };
}

/** For the load balancer: registered before the rate limits (see createApp). */
export function healthRoute(app: Hono<Env>, deps: AppDeps): void {
  app.get("/health", async (c) => {
    const ok = await deps.db.query("SELECT 1").then(
      () => true,
      () => false,
    );
    return c.json({ ok }, ok ? 200 : 503);
  });
}

export function publicRoutes(app: Hono<Env>, deps: AppDeps): void {
  app.get("/v1/leaderboard", async (c) => {
    const competition = await latestCompetition(deps.db);
    const board = await leaderboard(deps, competition, null);
    const body: LeaderboardResponse = {
      competition: competition && {
        id: competition.id,
        name: competition.name,
        startsAt: competition.startsAt.toISOString(),
        endsAt: competition.endsAt.toISOString(),
        pool: (competition.pool + competition.dropPool).toString(),
      },
      sponsor: competition ? sponsorView(competition) : null,
      entries: board.entries,
      dropSeedHash: competition?.dropSeedHash ?? null,
      dropSeed: competition?.dropSeed?.toString("hex") ?? null,
    };
    return c.json(body);
  });

  app.get("/v1/rounds/:signature/verify", async (c) => {
    const signature = parseParam(c.req.param("signature"), SignatureParam, "signature");
    return c.json(await verify(deps, signature));
  });

  app.get("/v1/geo", (c) =>
    c.json({ allowed: geoAllowed(c, deps.geo), country: country(c, deps.geo) } satisfies GeoResponse),
  );
}
