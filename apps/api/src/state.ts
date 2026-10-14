// GET /v1/state: everything the mod's panel shows, read from the chain and the index.
import type { PublicKey } from "@solana/web3.js";
import type { Game, LeaderboardEntry, RoundView, StateResponse } from "@tilt/mod/protocol";
import type { PlayerState } from "./chain";
import { runningCompetition, sponsorView, standings, toEntry, type Competition } from "./competitions/store";
import type { AppDeps } from "./deps";
import { buildRoundView } from "./games/view";
import { blockReason } from "./limits";
import { saveDetail, settledSignature } from "./rounds";
import { walletOf } from "./wallets";

/** RTP before Tilt's 1% (spec §4.3). Baccarat shows the player bet (banker 98.94, tie ≈ 85.9). */
export const RTP: Record<Game, string> = { blackjack: "99.00", roulette: "97.30", baccarat: "98.76", slots: "96.16" };
export const LEADERBOARD_SIZE = 10;

/** Balance plus deposits Solana recorded but the rollup has not credited yet (it will at the next move). */
export function spendable(account: PlayerState, deposited: bigint | null): bigint {
  const uncredited = deposited !== null && deposited > account.credited ? deposited - account.credited : 0n;
  return account.balance + uncredited;
}

async function roundView(deps: AppDeps, player: string, account: PlayerState): Promise<RoundView | null> {
  const r = account.round;
  const idle = r.status.kind === "idle";
  if (idle && account.rounds === 0) return null;
  // A blackjack round played before tables existed has no hands left to show: the protocol's
  // 1..6 hands cannot describe it, so the panel starts as if no round had been played.
  if (r.outcome.game === "blackjack" && r.outcome.hands.length === 0) return null;
  const number = idle ? account.rounds : account.rounds + 1;
  let signature: string | null = null;
  if (idle) {
    // The account still holds the last round: keep its detail for /verify if the indexer missed it.
    await saveDetail(deps.db, player, number, r.requestId, r.outcome);
    signature = await settledSignature(deps.db, player, number);
  }
  return buildRoundView({ player, number, ...r, settledSignature: signature });
}

export async function leaderboard(
  deps: AppDeps,
  competition: Competition | null,
  you: string | null,
): Promise<{ entries: LeaderboardEntry[]; rank: number | null }> {
  if (!competition) return { entries: [], rank: null };
  const rows = await standings(deps.db, competition, LEADERBOARD_SIZE, you);
  return { entries: rows.map((s) => toEntry(s, you)), rank: rows.find((s) => s.player === you)?.rank ?? null };
}

async function playerPart(deps: AppDeps, userId: string, wallet: PublicKey | null) {
  if (!wallet) return { accountOpen: false, balance: "0", round: null, blocked: null };
  const player = wallet.toBase58();
  const [account, deposited, blocked] = await Promise.all([
    deps.chain.playerAccount(wallet),
    deps.chain.deposited(wallet),
    blockReason(deps.db, userId, { kind: "bet", player }),
  ]);
  if (!account) return { accountOpen: false, balance: "0", round: null, blocked };
  return {
    accountOpen: true,
    balance: spendable(account, deposited).toString(),
    round: await roundView(deps, player, account),
    blocked,
  };
}

export async function buildState(deps: AppDeps, userId: string): Promise<StateResponse> {
  const wallet = await walletOf(deps.db, deps.relay, userId);
  const [mine, config, competition, pendingIntentId] = await Promise.all([
    playerPart(deps, userId, wallet),
    deps.chain.config(),
    runningCompetition(deps.db),
    deps.intents.pending(userId),
  ]);
  const board = await leaderboard(deps, competition, wallet?.toBase58() ?? null);
  return {
    ...mine,
    pendingIntentId,
    limits: { minBet: config.minBet.toString(), maxBet: config.maxBet.toString() },
    rtp: RTP,
    sponsor: competition ? sponsorView(competition) : null,
    leaderboard: board.entries,
    rank: board.rank,
  };
}
