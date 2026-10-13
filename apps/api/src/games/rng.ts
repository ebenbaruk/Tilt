// TS port of `chain/programs/tilt/src/rng.rs`: one 32-byte VRF output expanded with
// splitmix64 into unbiased draws. Must stay bit-for-bit identical to the program.

const U64 = (1n << 64n) - 1n;
export const VRF_BYTES = 32;

export class Rng {
  private state: bigint;

  private constructor(seed: bigint) {
    this.state = seed;
  }

  /** XOR of the four little-endian u64 words of the VRF output. */
  static fromVrf(randomness: Uint8Array): Rng {
    if (randomness.length !== VRF_BYTES) throw new Error(`randomness must be ${VRF_BYTES} bytes`);
    const view = new DataView(randomness.buffer, randomness.byteOffset, randomness.byteLength);
    let seed = 0n;
    for (let i = 0; i < VRF_BYTES; i += 8) seed ^= view.getBigUint64(i, true);
    return new Rng(seed);
  }

  nextU64(): bigint {
    this.state = (this.state + 0x9e37_79b9_7f4a_7c15n) & U64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & U64;
    z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & U64;
    return z ^ (z >> 31n);
  }

  /** Uniform in `0..n`, with the program's rejection sampling. */
  below(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error("below() needs a positive integer");
    const bound = BigInt(n);
    const limit = U64 - (U64 % bound);
    for (;;) {
      const x = this.nextU64();
      if (x < limit) return Number(x % bound);
    }
  }

  /** Card rank from an infinite deck: 1 (ace) to 13 (king). */
  card(): number {
    return this.below(13) + 1;
  }
}
