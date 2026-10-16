// Request bodies, validated at the boundary. Each schema is checked against the frozen
// protocol types, so a drift between them fails the typecheck.
import {
  Amount,
  DICE_MAX_WINNING,
  DICE_MIN_WINNING,
  diceWinningRolls,
  FlipSide,
  HiloGuess,
  KenoPicks,
  LIMBO_MAX_TARGET,
  LIMBO_MIN_TARGET,
  MAX_BLACKJACK_HANDS,
  MAX_FLIPS,
  MAX_MINES,
  MINES_TILES,
  TOWER_MAX_TILES,
  TowerDifficulty,
  WHEEL_SEGMENTS,
  WheelRisk,
} from "@tilt/contract";
import type { ImpressionRequest, PlayAction, PlayRequest, RouletteBet } from "@tilt/mod/protocol";
import { z } from "zod";
import type { DepositRequest, DeviceApproveRequest, ExcludeRequest, LimitsRequest, WithdrawRequest } from "./public";
import { MAX_EXCLUSION_DAYS } from "./limits";

// Lowercase: intents are stored lowercased, and limit checks compare ids in SQL.
const Uuid = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
const OneToThree = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const RouletteBet = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("straight"), number: z.number().int().min(0).max(36) }).strict(),
  z.object({ kind: z.literal("red") }).strict(),
  z.object({ kind: z.literal("black") }).strict(),
  z.object({ kind: z.literal("odd") }).strict(),
  z.object({ kind: z.literal("even") }).strict(),
  z.object({ kind: z.literal("low") }).strict(),
  z.object({ kind: z.literal("high") }).strict(),
  z.object({ kind: z.literal("dozen"), dozen: OneToThree }).strict(),
  z.object({ kind: z.literal("column"), column: OneToThree }).strict(),
]) satisfies z.ZodType<RouletteBet>;

/** Game moves only: deposits and withdrawals are not part of this union, so the mod cannot send them. */
export const PlayActionSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("blackjack_bet"),
        amount: Amount,
        hands: z.number().int().min(1).max(MAX_BLACKJACK_HANDS),
      })
      .strict(),
    z.object({ type: z.literal("blackjack_hit") }).strict(),
    z.object({ type: z.literal("blackjack_stand") }).strict(),
    z.object({ type: z.literal("blackjack_double") }).strict(),
    z.object({ type: z.literal("blackjack_split") }).strict(),
    z.object({ type: z.literal("roulette_spin"), amount: Amount, bet: RouletteBet }).strict(),
    z.object({ type: z.literal("baccarat_deal"), amount: Amount, bet: z.enum(["player", "banker", "tie"]) }).strict(),
    z.object({ type: z.literal("slots_spin"), amount: Amount }).strict(),
    z.object({ type: z.literal("mines_bet"), amount: Amount, mines: z.number().int().min(1).max(MAX_MINES) }).strict(),
    z
      .object({
        type: z.literal("mines_reveal"),
        tile: z
          .number()
          .int()
          .min(0)
          .max(MINES_TILES - 1),
      })
      .strict(),
    z.object({ type: z.literal("mines_cashout") }).strict(),
    // The target's range depends on `over`: checked below.
    z.object({ type: z.literal("dice_roll"), amount: Amount, target: z.number().int(), over: z.boolean() }).strict(),
    z
      .object({
        type: z.literal("limbo_play"),
        amount: Amount,
        target: z.number().int().min(LIMBO_MIN_TARGET).max(LIMBO_MAX_TARGET),
      })
      .strict(),
    z
      .object({
        type: z.literal("flip_play"),
        amount: Amount,
        side: FlipSide,
        flips: z.number().int().min(1).max(MAX_FLIPS),
      })
      .strict(),
    z.object({ type: z.literal("keno_play"), amount: Amount, picks: KenoPicks }).strict(),
    z
      .object({
        type: z.literal("wheel_spin"),
        amount: Amount,
        segments: z.number().refine((s) => WHEEL_SEGMENTS.includes(s), "segments must be 10, 20, 30, 40 or 50"),
        risk: WheelRisk,
      })
      .strict(),
    z.object({ type: z.literal("hilo_bet"), amount: Amount }).strict(),
    z.object({ type: z.literal("hilo_guess"), guess: HiloGuess }).strict(),
    z.object({ type: z.literal("hilo_cashout") }).strict(),
    z.object({ type: z.literal("tower_bet"), amount: Amount, difficulty: TowerDifficulty }).strict(),
    // The level's tile count depends on the round's difficulty: the program checks that bound.
    z
      .object({
        type: z.literal("tower_climb"),
        tile: z
          .number()
          .int()
          .min(0)
          .max(TOWER_MAX_TILES - 1),
      })
      .strict(),
    z.object({ type: z.literal("tower_cashout") }).strict(),
  ])
  .superRefine((action, ctx) => {
    if (action.type !== "dice_roll") return;
    const winning = diceWinningRolls(action.target, action.over);
    if (winning < DICE_MIN_WINNING || winning > DICE_MAX_WINNING) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "win chance must be 1% to 98%" });
    }
  }) satisfies z.ZodType<PlayAction>;

export const PlayRequestSchema = z
  .object({ intentId: Uuid, action: PlayActionSchema })
  .strict() satisfies z.ZodType<PlayRequest>;

/** Longest sponsor name; campaigns are refused above it, or the mod could not report them. */
export const MAX_SPONSOR_LENGTH = 100;

export const ImpressionSchema = z
  .object({ sponsor: z.string().min(1).max(MAX_SPONSOR_LENGTH), seconds: z.number().int().min(1).max(60) })
  .strict() satisfies z.ZodType<ImpressionRequest>;

export const DeviceTokenSchema = z.object({ deviceCode: z.string().min(1).max(100) }).strict();

export const DeviceApproveSchema = z
  .object({ userCode: z.string().min(1).max(20) })
  .strict() satisfies z.ZodType<DeviceApproveRequest>;

const MoneySchema = z.object({ intentId: Uuid, amount: Amount }).strict();
export const DepositSchema = MoneySchema satisfies z.ZodType<DepositRequest>;
export const WithdrawSchema = MoneySchema satisfies z.ZodType<WithdrawRequest>;

export const LimitsSchema = z
  .object({ dailyDeposit: Amount.nullable(), dailyLoss: Amount.nullable() })
  .strict() satisfies z.ZodType<LimitsRequest>;

export const ExcludeSchema = z
  .object({ days: z.number().int().min(1).max(MAX_EXCLUSION_DAYS) })
  .strict() satisfies z.ZodType<ExcludeRequest>;

export const IdParam = Uuid;
/** Base58 transaction signature (64 bytes encode to 86–88 characters). */
export const SignatureParam = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
