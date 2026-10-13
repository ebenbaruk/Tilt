//! Turns one 32-byte VRF output into as many unbiased draws as a round needs.
//!
//! Every draw of a round comes from a single verified VRF output, so anyone can
//! replay a round from its randomness and get the same cards or numbers.

pub struct Rng(u64);

impl Rng {
    pub fn from_vrf(randomness: [u8; 32]) -> Self {
        let seed = randomness.chunks_exact(8).fold(0u64, |acc, chunk| {
            let mut word = [0u8; 8];
            word.copy_from_slice(chunk);
            acc ^ u64::from_le_bytes(word)
        });
        Self(seed)
    }

    /// splitmix64: a tiny, well-mixed generator; plenty for expanding a VRF seed.
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `0..n`, with rejection sampling so no outcome is favoured.
    pub fn below(&mut self, n: u64) -> u64 {
        debug_assert!(n > 0);
        let limit = u64::MAX - u64::MAX % n;
        loop {
            let x = self.next_u64();
            if x < limit {
                return x % n;
            }
        }
    }

    /// A card rank from an infinite deck: 1 (ace) to 13 (king).
    pub fn card(&mut self) -> u8 {
        self.below(13) as u8 + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_randomness_replays_the_same_draws() {
        let mut a = Rng::from_vrf([7; 32]);
        let mut b = Rng::from_vrf([7; 32]);
        for _ in 0..100 {
            assert_eq!(a.card(), b.card());
        }
    }

    #[test]
    fn draws_cover_the_whole_range_evenly() {
        let mut rng = Rng::from_vrf([42; 32]);
        let mut counts = [0u32; 13];
        let n = 130_000;
        for _ in 0..n {
            let card = rng.card();
            assert!((1..=13).contains(&card));
            counts[card as usize - 1] += 1;
        }
        for c in counts {
            // Expected 10 000 per rank; 5 sigma is about 480.
            assert!((9_500..=10_500).contains(&c), "rank count {c}");
        }
    }
}
