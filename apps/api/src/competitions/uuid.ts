// UUID version 5 (RFC 9562 §5.5): a deterministic id from a namespace and a name. Prize payout
// ids are derived this way, so re-running a payout can only ever reuse the same id.
import { createHash } from "node:crypto";

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

export function uuidv5(namespace: string, name: string): string {
  if (!UUID_FORMAT.test(namespace)) throw new Error("namespace must be a UUID");
  const bytes = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Namespace of every Tilt prize payout id: uuidv5(URL, "https://tilt.gg/prizes"). Never change it:
 *  ids of prizes already paid would no longer match. */
export const PRIZE_NAMESPACE = uuidv5(URL_NAMESPACE, "https://tilt.gg/prizes");

export const prizeId = (competitionId: string, kind: "rank" | "drop", rank: number) =>
  uuidv5(PRIZE_NAMESPACE, `${competitionId}:${kind}:${rank}`);
