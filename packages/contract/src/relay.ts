// API of the relay (`apps/wallet`), called only by `apps/api` over the private network.
// Both sides validate with these schemas (spec §7). Amounts are integer USDC base units
// (6 decimals) sent as decimal strings, never floats.
import { z } from "zod";

/** Integer USDC base units as a decimal string, e.g. "2500000" for 2.50 USDC. */
export const Amount = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "positive integer in USDC base units")
  // Zod still runs refinements after a failed regex: guard before BigInt, which throws on bad input.
  .refine((s) => /^\d+$/.test(s) && BigInt(s) <= 0xffff_ffff_ffff_ffffn, "exceeds u64");

export const RouletteBet = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("straight"), number: z.number().int().min(0).max(36) }),
  z.object({ kind: z.literal("red") }),
  z.object({ kind: z.literal("black") }),
  z.object({ kind: z.literal("odd") }),
  z.object({ kind: z.literal("even") }),
  z.object({ kind: z.literal("low") }),
  z.object({ kind: z.literal("high") }),
  z.object({ kind: z.literal("dozen"), dozen: z.number().int().min(1).max(3) }),
  z.object({ kind: z.literal("column"), column: z.number().int().min(1).max(3) }),
]);
export type RouletteBet = z.infer<typeof RouletteBet>;

/** Chips one `roulette_chips` spin can carry (`MAX_CHIPS` on-chain). */
export const MAX_ROULETTE_CHIPS = 20;

/** One chip: its own bet and amount (each within the bet limits, checked by the program). */
export const RouletteChip = z.object({ bet: RouletteBet, amount: Amount });
export type RouletteChip = z.infer<typeof RouletteChip>;

/** 1 to 20 chips, at most one per bet (the client merges chips on the same bet). */
export const RouletteChips = z
  .array(RouletteChip)
  .min(1)
  .max(MAX_ROULETTE_CHIPS)
  // Parsed bets have their keys in schema order, so equal bets serialize alike.
  .refine((chips) => new Set(chips.map((chip) => JSON.stringify(chip.bet))).size === chips.length, "distinct bets");

export const BaccaratBet = z.enum(["player", "banker", "tie"]);
export type BaccaratBet = z.infer<typeof BaccaratBet>;

/** Hands one blackjack round can play against a single dealer (`MAX_HANDS` on-chain). */
export const MAX_BLACKJACK_HANDS = 6;

/** Mines board: 25 tiles (0 to 24, row-major on a 5×5 grid), 1 to 24 mines (`MAX_MINES` on-chain). */
export const MINES_TILES = 25;
export const MAX_MINES = MINES_TILES - 1;

/** Dice rolls are 0 to 9999 (shown as 00.00 to 99.99); a bet wins on 100 to 9800 of them (1 % to 98 %). */
export const DICE_ROLLS = 10_000;
export const DICE_MIN_WINNING = 100;
export const DICE_MAX_WINNING = 9_800;

/** Rolls winning a dice bet: under wins below `target`, over wins from `target` up. */
export const diceWinningRolls = (target: number, over: boolean) => (over ? DICE_ROLLS - target : target);

/** Limbo targets are multipliers × 100: 1.01× to 10 000×. */
export const LIMBO_MIN_TARGET = 101;
export const LIMBO_MAX_TARGET = 1_000_000;

export const MAX_FLIPS = 10;
export const FlipSide = z.enum(["heads", "tails"]);
export type FlipSide = z.infer<typeof FlipSide>;

/** Keno: 1 to 10 distinct numbers out of 1 to 40; ten are drawn. */
export const KENO_NUMBERS = 40;
export const MAX_KENO_PICKS = 10;
export const KenoPicks = z
  .array(z.number().int().min(1).max(KENO_NUMBERS))
  .min(1)
  .max(MAX_KENO_PICKS)
  .refine((picks) => new Set(picks).size === picks.length, "distinct numbers");

export const WHEEL_SEGMENTS: readonly number[] = [10, 20, 30, 40, 50];
export const WheelRisk = z.enum(["low", "medium", "high"]);
export type WheelRisk = z.infer<typeof WheelRisk>;

export const HiloGuess = z.enum(["higher", "lower", "skip"]);
export type HiloGuess = z.infer<typeof HiloGuess>;

/** Tower: 9 levels; tiles per level by difficulty (easy 4, medium 3, hard 2, expert 3, master 4). */
export const TowerDifficulty = z.enum(["easy", "medium", "hard", "expert", "master"]);
export type TowerDifficulty = z.infer<typeof TowerDifficulty>;
export const TOWER_MAX_TILES = 4;

const ActionShape = z.discriminatedUnion("type", [
  /** First deposit: opens the account and moves it into the rollup (onboarding fee deducted). */
  z.object({ type: z.literal("open_account"), amount: Amount }),
  z.object({ type: z.literal("deposit"), amount: Amount }),
  /** `amount` is the bet on EACH hand; `hands` (1 to 6) are all played against one dealer. */
  z.object({ type: z.literal("blackjack_bet"), amount: Amount, hands: z.number().int().min(1).max(MAX_BLACKJACK_HANDS) }),
  z.object({ type: z.literal("blackjack_hit") }),
  z.object({ type: z.literal("blackjack_stand") }),
  z.object({ type: z.literal("blackjack_double") }),
  /** Splits the active hand's pair into two hands (one more base bet), at most 4 per round. */
  z.object({ type: z.literal("blackjack_split") }),
  z.object({ type: z.literal("roulette_spin"), amount: Amount, bet: RouletteBet }),
  /** One spin with several chips; the stake is their total. Plays on the player's roulette table. */
  z.object({ type: z.literal("roulette_chips"), chips: RouletteChips }),
  z.object({ type: z.literal("baccarat_deal"), amount: Amount, bet: BaccaratBet }),
  z.object({ type: z.literal("slots_spin"), amount: Amount }),
  /** Starts a Mines round of `amount` with `mines` mines (1 to 24); no draw until a reveal. */
  z.object({ type: z.literal("mines_bet"), amount: Amount, mines: z.number().int().min(1).max(MAX_MINES) }),
  /** Reveals one hidden tile (0 to 24); a mine ends the round. */
  z.object({ type: z.literal("mines_reveal"), tile: z.number().int().min(0).max(MINES_TILES - 1) }),
  /** Cashes out at the current multiplier, once at least one tile is revealed. */
  z.object({ type: z.literal("mines_cashout") }),
  /** Rolls 0 to 9999: under wins iff roll < target, over iff roll ≥ target (1 % to 98 % chance, checked by `Action`). */
  z.object({ type: z.literal("dice_roll"), amount: Amount, target: z.number().int().min(0).max(DICE_ROLLS), over: z.boolean() }),
  /** Wins `target` (multiplier × 100) when the drawn multiplier reaches it. */
  z.object({ type: z.literal("limbo_play"), amount: Amount, target: z.number().int().min(LIMBO_MIN_TARGET).max(LIMBO_MAX_TARGET) }),
  /** Wins iff every one of `flips` coins lands on `side`. */
  z.object({ type: z.literal("flip_play"), amount: Amount, side: FlipSide, flips: z.number().int().min(1).max(MAX_FLIPS) }),
  z.object({ type: z.literal("keno_play"), amount: Amount, picks: KenoPicks }),
  z.object({
    type: z.literal("wheel_spin"),
    amount: Amount,
    segments: z.number().int().refine((n) => WHEEL_SEGMENTS.includes(n), "10, 20, 30, 40 or 50"),
    risk: WheelRisk,
  }),
  /** Starts a Hilo round and draws its first card. */
  z.object({ type: z.literal("hilo_bet"), amount: Amount }),
  /** Higher or same / lower or same, strict on an ace (higher) and a king (lower); an 11th skip is refused by the program. */
  z.object({ type: z.literal("hilo_guess"), guess: HiloGuess }),
  /** Cashes out once at least one guess was right. */
  z.object({ type: z.literal("hilo_cashout") }),
  /** Starts a Tower round; no draw until the first climb. */
  z.object({ type: z.literal("tower_bet"), amount: Amount, difficulty: TowerDifficulty }),
  /** Picks a tile of the next level; one past the difficulty's tiles is refused by the program. */
  z.object({ type: z.literal("tower_climb"), tile: z.number().int().min(0).max(TOWER_MAX_TILES - 1) }),
  /** Cashes out once at least one level is climbed. */
  z.object({ type: z.literal("tower_cashout") }),
  /** Pays to the player's own wallet; moving funds out of it is signed by the player on the web. */
  z.object({ type: z.literal("withdraw"), amount: Amount }),
]);

/** What a player wants to do. The relay turns it into one Solana or rollup transaction. */
export const Action = ActionShape.superRefine((action, ctx) => {
  if (action.type !== "dice_roll") return;
  const winning = diceWinningRolls(action.target, action.over);
  if (winning < DICE_MIN_WINNING || winning > DICE_MAX_WINNING) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "1 % to 98 % chance" });
  }
});
export type Action = z.infer<typeof Action>;

/** Privy user id, e.g. `did:privy:cm3np4u9j001rc8b73seqmqqk` (a lowercase cuid). Strict, as it
 *  ends up in URLs, logs and database keys. */
export const PrivyUserId = z.string().regex(/^did:privy:[a-z0-9]{20,40}$/, "Privy user id (did:privy:…)");

/** Lowercased, so the same UUID in another case is the same intent, not a conflict. */
const Uuid = z.string().uuid().transform((s) => s.toLowerCase());

export const IntentRequest = z.object({
  /** Client-generated; replaying the same id never runs the action twice. */
  intentId: Uuid,
  userId: PrivyUserId,
  action: Action,
  /** Required for open_account, deposit and withdraw (403 CONSENT_REQUIRED otherwise): the
   *  player's Privy identity token, issued less than 5 minutes ago. Never stored by the relay.
   *  A replayed intent needs a fresh token too; to follow an intent, poll GET /intents/:id. */
  consent: z.object({ identityToken: z.string().min(1).max(4096) }).optional(),
});
export type IntentRequest = z.infer<typeof IntentRequest>;

export const ErrorCode = z.enum([
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "UNKNOWN_USER",
  "INTENT_CONFLICT",
  /** Another intent of this player is still in flight; retry once it settles. */
  "PLAYER_BUSY",
  /** The relay's caps (deposits, promo payouts) would be exceeded. */
  "LIMIT_EXCEEDED",
  /** Missing, invalid, stale or someone else's identity token on an action that needs consent. */
  "CONSENT_REQUIRED",
  "ACCOUNT_NOT_OPEN",
  "ACCOUNT_ALREADY_OPEN",
  /** The player's game account (blackjack, one-draw or roulette table, Mines, Hilo or Tower board)
   *  could not be opened in the rollup in time; nothing was played, the same action can be sent again. */
  "TABLE_NOT_READY",
  "PROGRAM_ERROR",
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * pending: in flight or outcome not yet known (the relay settles it by itself, poll GET /intents/:id);
 * submitted: the transaction landed successfully on-chain; failed: it did not and never will.
 */
export const IntentStatus = z.enum(["pending", "submitted", "failed"]);
export type IntentStatus = z.infer<typeof IntentStatus>;

export const IntentResponse = z.object({
  intentId: z.string().uuid(),
  status: IntentStatus,
  /** Transaction signature once submitted (Solana or rollup, depending on the action). */
  signature: z.string().optional(),
  /** Anchor error name when the program refused the action, e.g. "InsufficientBalance". */
  error: z.object({ code: ErrorCode, message: z.string() }).optional(),
});
export type IntentResponse = z.infer<typeof IntentResponse>;

/** Sponsor prize (competition or drop) paid from the promo pool straight to the player's wallet. */
export const PromoPayoutRequest = z.object({
  /** Client-generated; replaying the same id never pays twice (also enforced on-chain). A 409
   *  INTENT_CONFLICT means the id is already taken: read GET /payouts/promo/:id, never re-issue
   *  the same prize under a new id. */
  payoutId: Uuid,
  userId: PrivyUserId,
  amount: Amount,
  /** Which competition or drop pool this comes from (bookkeeping, not on-chain). */
  poolId: z.string().min(1).max(100),
  reason: z.string().min(1).max(200),
});
export type PromoPayoutRequest = z.infer<typeof PromoPayoutRequest>;

export const PromoPayoutResponse = IntentResponse.omit({ intentId: true }).extend({ payoutId: z.string().uuid() });
export type PromoPayoutResponse = z.infer<typeof PromoPayoutResponse>;

export const UserResponse = z.object({
  userId: z.string(),
  /** The player's Solana wallet (Privy embedded wallet). */
  solanaAddress: z.string(),
  /** Whether the player account exists (first deposit done). */
  accountOpen: z.boolean(),
});
export type UserResponse = z.infer<typeof UserResponse>;

export const ErrorResponse = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
