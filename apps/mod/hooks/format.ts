// Pure formatting: money, durations, cards. No `$`, so it is unit-tested directly.
import type { Card, RouletteBet } from "./protocol";

export const MINUS = "−";
export const SEPARATOR = " · ";

/** USDC has 6 decimals; the mod shows cents, so 10,000 base units per cent. */
const BASE_UNITS_PER_CENT = 10_000n;
const CENTS_PER_USDC = 100n;

export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Base units ("12400000") to "12.40", en-US grouping; sub-cent dust is truncated toward zero. */
export function formatUsdc(amount: string): string {
  const value = BigInt(amount);
  const cents = (value < 0n ? -value : value) / BASE_UNITS_PER_CENT;
  const whole = groupDigits((cents / CENTS_PER_USDC).toString());
  const fraction = (cents % CENTS_PER_USDC).toString().padStart(2, "0");
  const sign = value < 0n && cents > 0n ? MINUS : "";

  return `${sign}${whole}.${fraction}`;
}

/** A delta with its sign always shown: "+1.25", "−0.50", "0.00". */
export function formatSigned(net: string): string {
  const text = formatUsdc(net);

  return BigInt(net) > 0n && text !== "0.00" ? `+${text}` : text;
}

/** Mines multipliers come with exactly 4 decimals ("1.0312"). */
const MULTIPLIER_DECIMALS = 4;
const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);

/**
 * What a Mines cash-out at `multiplier` returns on `stake`, in base units, before Tilt's fee:
 * stake × multiplier, floored (the multiplier is floored too, so both only round down). Integer
 * math on the decimal string, never a float; the program computes the real payout.
 */
export function minesPayout(stake: string, multiplier: string): string {
  const [whole = "0", fraction = ""] = multiplier.split(".");
  const scaled = BigInt(`${whole}${fraction.padEnd(MULTIPLIER_DECIMALS, "0").slice(0, MULTIPLIER_DECIMALS)}`);

  return ((BigInt(stake) * scaled) / MULTIPLIER_SCALE).toString();
}

/** 31_400 → "31s", 374_000 → "6m 14s", 3_720_000 → "1h 2m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Time left in a competition: "12m", "14h 3m", "2d 4h", or "ended". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) {
    return "ended";
  }

  const minutes = Math.max(1, Math.floor(ms / 60_000));

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const FACES: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export function rankLabel(rank: number): string {
  return FACES[rank] ?? String(rank);
}

export function isRedSuit(suit: Card["suit"]): boolean {
  return suit === "♥" || suit === "♦";
}

/** "A♠", "10♥": a card's rank and suit, as the table and the summaries draw it. */
export function cardFace(card: Card): string {
  return `${rankLabel(card.rank)}${card.suit}`;
}

/** "A♠ 10♥", for one-line summaries. */
export function cardsInline(cards: readonly Card[]): string {
  return cards.map(cardFace).join(" ");
}

const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function pocketColor(pocket: number): "green" | "red" | "black" {
  if (pocket === 0) {
    return "green";
  }

  return RED_POCKETS.has(pocket) ? "red" : "black";
}

export function rouletteBetLabel(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return `number ${bet.number}`;
    case "dozen":
      return `dozen ${bet.dozen}`;
    case "column":
      return `column ${bet.column}`;
    default:
      return bet.kind;
  }
}

/** Control characters (escape sequences) and format characters (bidi overrides, zero-width joiners). */
const UNSHOWN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const MAX_SHOWN_TEXT = 200;

/** Server text is drawn in the person's terminal: no escape sequence reaches it, no bidi override
 * reorders what follows, and the cut never splits an emoji into a lone surrogate. */
export function cleanText(text: string): string {
  return Array.from(text.replace(UNSHOWN_CHARACTERS, "")).slice(0, MAX_SHOWN_TEXT).join("");
}

/** The program's refusals a player can meet, in words; the api sends their Anchor names. */
const REFUSALS: Record<string, string> = {
  VaultTooSmall: "The casino cannot cover a bet this size right now: try a smaller one.",
  WinCapReached: "Your win limit is being raised: try again in a moment.",
  RoundGainTooHigh: "This bet could win more than one round allows: lower it.",
  InsufficientBalance: "Not enough balance for this bet.",
  AmountOutOfRange: "This bet is outside the table limits.",
  Paused: "Play is paused for now.",
};

/** Why a move failed, as the pane says it. */
export function moveFailure(message: string): string {
  return REFUSALS[message] ?? cleanText(message);
}
