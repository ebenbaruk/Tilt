const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact countdown, e.g. "2d 4h", "14h 3m", "9m"; "ended" once past. */
export function timeLeft(endsAt: string, now: number = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (Number.isNaN(ms)) return "unknown";
  if (ms <= 0) return "ended";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}
