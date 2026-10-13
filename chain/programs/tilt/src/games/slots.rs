//! Three-reel slot machine. Every reel is the same weighted strip; one VRF draw spins all three.
//! The paytable is public and its RTP is computed exactly in the tests (96.16% before Tilt's fee).

use anchor_lang::prelude::*;

use crate::rng::Rng;

pub const SEVEN: u8 = 0;
pub const BAR: u8 = 1;
pub const BELL: u8 = 2;
pub const PLUM: u8 = 3;
pub const ORANGE: u8 = 4;
pub const LEMON: u8 = 5;
pub const CHERRY: u8 = 6;

/// Stops per symbol on each reel, indexed by symbol.
pub const WEIGHTS: [u64; 7] = [1, 2, 4, 6, 8, 10, 10];
/// Stake multiple for three of a kind, indexed by symbol.
pub const THREE_OF_A_KIND: [u64; 7] = [250, 100, 40, 20, 12, 5, 10];
/// Stake multiple for exactly two cherries.
pub const TWO_CHERRIES: u64 = 4;
pub const MAX_MULTIPLE: u64 = 250;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq, Debug,
)]
pub struct SlotsSpin {
    pub reels: [u8; 3],
}

/// Saturates, like every game's `max_gain`: it is computed before `start_round` checks the
/// stake, which then refuses a huge one as out of range instead of the program panicking.
pub fn max_gain(stake: u64) -> u64 {
    stake.saturating_mul(MAX_MULTIPLE - 1)
}

fn multiple(reels: [u8; 3]) -> u64 {
    let [a, b, c] = reels;
    if a == b && b == c {
        return THREE_OF_A_KIND[a as usize];
    }
    if reels.iter().filter(|&&s| s == CHERRY).count() == 2 {
        return TWO_CHERRIES;
    }
    0
}

fn stop(rng: &mut Rng) -> u8 {
    let total: u64 = WEIGHTS.iter().sum();
    let mut x = rng.below(total);
    for (symbol, &w) in WEIGHTS.iter().enumerate() {
        if x < w {
            return symbol as u8;
        }
        x -= w;
    }
    unreachable!("x < total")
}

impl SlotsSpin {
    pub fn spin(&mut self, rng: &mut Rng) {
        self.reels = [stop(rng), stop(rng), stop(rng)];
    }

    pub fn gross(&self, stake: u64) -> u64 {
        stake * multiple(self.reels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_rtp_is_about_96_percent() {
        let mut returned: u64 = 0;
        let mut weight: u64 = 0;
        for a in 0..7u8 {
            for b in 0..7u8 {
                for c in 0..7u8 {
                    let w = WEIGHTS[a as usize] * WEIGHTS[b as usize] * WEIGHTS[c as usize];
                    returned += multiple([a, b, c]) * w;
                    weight += w;
                }
            }
        }
        let rtp = returned as f64 / weight as f64;
        assert!((rtp - 0.9616).abs() < 0.0002, "slots RTP {rtp}");
    }

    #[test]
    fn paytable() {
        assert_eq!(SlotsSpin { reels: [SEVEN; 3] }.gross(10), 2_500);
        assert_eq!(
            SlotsSpin {
                reels: [CHERRY, CHERRY, BAR]
            }
            .gross(10),
            40
        );
        assert_eq!(
            SlotsSpin {
                reels: [CHERRY, LEMON, BAR]
            }
            .gross(10),
            0
        );
        assert_eq!(
            SlotsSpin {
                reels: [BELL, BELL, PLUM]
            }
            .gross(10),
            0
        );
    }

    #[test]
    fn max_multiple_matches_the_paytable() {
        assert_eq!(MAX_MULTIPLE, *THREE_OF_A_KIND.iter().max().unwrap());
    }

    #[test]
    fn reels_follow_the_weights() {
        let mut rng = Rng::from_vrf([9; 32]);
        let mut counts = [0u64; 7];
        let n = 410_000;
        for _ in 0..n {
            counts[stop(&mut rng) as usize] += 1;
        }
        for (symbol, &c) in counts.iter().enumerate() {
            let expected = n * WEIGHTS[symbol] / 41;
            let tolerance = expected / 20 + 50;
            assert!(
                c.abs_diff(expected) < tolerance,
                "symbol {symbol}: {c} vs {expected}"
            );
        }
    }
}
