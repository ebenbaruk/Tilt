// Index of settled rounds and VRF draws (written by the indexer, read by /state, /verify and
// the leaderboard). A display cache: the chain stays the source of truth.
import type { Game } from "@tilt/mod/protocol";
import type { Queryable } from "./db";
import type { Outcome } from "./games/round";

export interface SettledRound {
  signature: string;
  player: string;
  round: number;
  game: Game;
  stake: bigint;
  /** Program payout, net of the fee. */
  payout: bigint;
  fee: bigint;
  requestId: bigint;
  randomness: Buffer;
  settledAt: Date;
}

/** Games whose rounds can settle by a cash-out, without a VRF draw: its RoundSettled carries
 *  zero randomness and the request id of the last draw, already indexed. */
const CASH_OUT_GAMES: ReadonlySet<Game> = new Set(["mines", "hilo", "tower"]);

export const isCashout = (r: Pick<SettledRound, "game" | "randomness">) =>
  CASH_OUT_GAMES.has(r.game) && r.randomness.every((b) => b === 0);

export interface IndexedRound extends SettledRound {
  detail: Outcome | null;
}

export interface DrawRecord {
  /** Player account (PDA), the only account a VRF callback names. */
  account: string;
  requestId: bigint;
  randomness: Buffer;
  signature: string;
}

/** Idempotent: a round is stored once, whichever of the live feed or the backfill sees it first. */
export async function saveRound(db: Queryable, r: SettledRound): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO rounds (signature, player, round, game, stake, payout, fee, request_id, randomness, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [
      r.signature,
      r.player,
      r.round,
      r.game,
      r.stake.toString(),
      r.payout.toString(),
      r.fee.toString(),
      r.requestId.toString(),
      r.randomness.toString("hex"),
      r.settledAt,
    ],
  );
  return rowCount === 1;
}

export async function saveDraw(db: Queryable, d: DrawRecord): Promise<void> {
  await db.query(
    `INSERT INTO draws (account, request_id, randomness, signature) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [d.account, d.requestId.toString(), d.randomness.toString("hex"), d.signature],
  );
}

/** Records the round's detail as read from the account right after it settled. A blackjack
 *  round without hands was played before tables: its cards are no longer on-chain. */
export async function saveDetail(
  db: Queryable,
  player: string,
  round: number,
  requestId: bigint,
  detail: Outcome,
): Promise<void> {
  if (detail.game === "blackjack" && detail.hands.length === 0) return;
  await db.query(
    `UPDATE rounds SET detail = $4 WHERE player = $1 AND round = $2 AND request_id = $3 AND detail IS NULL`,
    [player, round, requestId.toString(), detail],
  );
}

interface RoundRow {
  signature: string;
  player: string;
  round: number;
  game: Game;
  stake: string;
  payout: string;
  fee: string;
  request_id: string;
  randomness: string;
  detail: Outcome | null;
  settled_at: Date;
}

const toRound = (r: RoundRow): IndexedRound => ({
  signature: r.signature,
  player: r.player,
  round: r.round,
  game: r.game,
  stake: BigInt(r.stake),
  payout: BigInt(r.payout),
  fee: BigInt(r.fee),
  requestId: BigInt(r.request_id),
  randomness: Buffer.from(r.randomness, "hex"),
  detail: r.detail,
  settledAt: r.settled_at,
});

export async function findRound(db: Queryable, signature: string): Promise<IndexedRound | null> {
  const { rows } = await db.query<RoundRow>("SELECT * FROM rounds WHERE signature = $1", [signature]);
  return rows[0] ? toRound(rows[0]) : null;
}

export async function settledSignature(db: Queryable, player: string, round: number): Promise<string | null> {
  const { rows } = await db.query<{ signature: string }>(
    "SELECT signature FROM rounds WHERE player = $1 AND round = $2",
    [player, round],
  );
  return rows[0]?.signature ?? null;
}

/** Request id that settled the player's previous round (0 before the first); null if not indexed. */
export async function previousRequestId(db: Queryable, player: string, round: number): Promise<bigint | null> {
  if (round <= 1) return 0n;
  const { rows } = await db.query<{ request_id: string }>(
    "SELECT request_id FROM rounds WHERE player = $1 AND round = $2",
    [player, round - 1],
  );
  return rows[0] ? BigInt(rows[0].request_id) : null;
}

/** The account's draws with after < request id <= upTo, in request order. */
export async function drawsBetween(db: Queryable, account: string, after: bigint, upTo: bigint): Promise<Buffer[]> {
  const { rows } = await db.query<{ randomness: string }>(
    `SELECT randomness FROM draws WHERE account = $1 AND request_id > $2 AND request_id <= $3 ORDER BY request_id`,
    [account, after.toString(), upTo.toString()],
  );
  return rows.map((r) => Buffer.from(r.randomness, "hex"));
}
