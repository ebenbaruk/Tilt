// Port of `games/wheel.rs`: 10 to 50 segments whose multipliers (×100) depend on the risk and
// sum to exactly 98 × segments (RTP 98.00 %); one draw picks the segment. The tables mirror the
// program's exactly (checked against its Rust in the parity tests).
import type { WheelRisk } from "@tilt/mod/protocol";
import type { Rng } from "./rng";

export const SEGMENTS: readonly number[] = [10, 20, 30, 40, 50];
export const RISKS: readonly WheelRisk[] = ["low", "medium", "high"];
/** Low risk: this block of 10 repeats around the wheel. */
const LOW = [140n, 120n, 120n, 120n, 0n, 120n, 120n, 120n, 120n, 0n];
/** Medium risk: the odd segments' multipliers for 10 to 50 segments; even ones pay 0. */
const MEDIUM: readonly (readonly bigint[])[] = [
  [190n, 150n, 200n, 140n, 300n],
  [150n, 200n, 150n, 200n, 150n, 200n, 150n, 200n, 160n, 400n],
  [150n, 200n, 150n, 200n, 150n, 200n, 150n, 200n, 150n, 200n, 150n, 200n, 150n, 190n, 500n],
  [
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    170n,
    600n,
  ],
  [
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    150n,
    200n,
    700n,
  ],
];
/** Every wheel returns this × segments (×100) in total; high risk puts it all on the last segment. */
const RETURN_PER_SEGMENT = 98n;
const HUNDRED = 100n;

export const isValid = (segments: number) => SEGMENTS.includes(segments);

/** Multiplier ×100 of `segment`. Needs valid `segments` and `segment < segments`. */
export function multiplier(risk: WheelRisk, segments: number, segment: number): bigint {
  switch (risk) {
    case "low":
      return LOW[segment % LOW.length];
    case "medium":
      return segment % 2 === 0 ? 0n : MEDIUM[segments / 10 - 1][Math.floor(segment / 2)];
    case "high":
      return segment === segments - 1 ? RETURN_PER_SEGMENT * BigInt(segments) : 0n;
  }
}

/** Every segment's multiplier ×100, in order. */
export const multipliers = (risk: WheelRisk, segments: number) =>
  Array.from({ length: segments }, (_, segment) => multiplier(risk, segments, segment));

export const spin = (rng: Rng, segments: number) => rng.below(segments);

export const gross = (stake: bigint, risk: WheelRisk, segments: number, segment: number) =>
  (stake * multiplier(risk, segments, segment)) / HUNDRED;
