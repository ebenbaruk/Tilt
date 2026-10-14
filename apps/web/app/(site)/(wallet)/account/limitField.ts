import type { PendingLimit } from "@tilt/api/public";
import { formatAmount } from "@/lib/amount";

const shown = (value: string | null) => (value === null ? "no limit" : `${formatAmount(value)} USDC`);

/** What the form field starts with, as typed (no thousands separator); empty means no limit. */
const typed = (value: string | null) => (value === null ? "" : formatAmount(value).replaceAll(",", ""));

/**
 * A limit field's starting text and its note. With a raise pending the field holds the raise, so
 * saving the form without touching it keeps the raise (and its delay); typing the current value
 * back cancels it.
 */
export function limitField(current: string | null, next: PendingLimit | null): { initial: string; hint?: string } {
  if (next === null) return { initial: typed(current) };
  const at = new Date(next.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return { initial: typed(next.value), hint: `${shown(current)} until ${at}, then ${shown(next.value)}.` };
}
