// Request bodies, validated at the boundary. Each schema is checked against the frozen
// protocol types, so a drift between them fails the typecheck.
import { Amount, MAX_BLACKJACK_HANDS } from "@tilt/contract";
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
export const PlayActionSchema = z.discriminatedUnion("type", [
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
  z.object({ type: z.literal("roulette_spin"), amount: Amount, bet: RouletteBet }).strict(),
  z.object({ type: z.literal("baccarat_deal"), amount: Amount, bet: z.enum(["player", "banker", "tie"]) }).strict(),
  z.object({ type: z.literal("slots_spin"), amount: Amount }).strict(),
]) satisfies z.ZodType<PlayAction>;

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
