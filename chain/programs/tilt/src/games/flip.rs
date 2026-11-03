//! Flip: the player calls heads or tails for 1 to 10 coins; every coin must land on the call.
//! A win pays `0.98 × 2^flips`: RTP 98.00% before Tilt's fee.

use anchor_lang::prelude::*;

use crate::games::{gain, to_u64};
use crate::rng::Rng;

pub const MAX_FLIPS: u8 = 10;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum CoinSide {
    Heads,
    Tails,
}

pub fn is_valid(flips: u8) -> bool {
    (1..=MAX_FLIPS).contains(&flips)
}

/// Tosses every coin, all of them for display: bit `i` set when coin `i` lands tails
/// (`rng.below(2)`: 0 heads, 1 tails).
pub fn toss(rng: &mut Rng, flips: u8) -> u16 {
    (0..flips).fold(0, |coins, i| coins | ((rng.below(2) as u16) << i))
}

pub fn wins(side: CoinSide, flips: u8, coins: u16) -> bool {
    let all_tails = (1u16 << flips) - 1;
    coins
        == match side {
            CoinSide::Heads => 0,
            CoinSide::Tails => all_tails,
        }
}

pub fn gross_win(stake: u64, flips: u8) -> u128 {
    stake as u128 * 98 * (1u128 << flips) / 100
}

/// Most the round can gain, `None` outside 1 to 10 coins.
pub fn max_gain(stake: u64, flips: u8) -> Option<u64> {
    is_valid(flips).then(|| gain(stake, gross_win(stake, flips)))
}

pub fn gross(stake: u64, side: CoinSide, flips: u8, coins: u16) -> u64 {
    if wins(side, flips, coins) {
        to_u64(gross_win(stake, flips))
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flips_outside_1_to_10_are_refused() {
        assert_eq!(max_gain(1_000, 0), None);
        assert_eq!(max_gain(1_000, 11), None);
        assert_eq!(max_gain(1_000, 1), Some(960));
        assert_eq!(max_gain(1_000, 10), Some(1_002_520));
    }

    #[test]
    fn every_coin_must_land_on_the_call() {
        assert!(wins(CoinSide::Heads, 3, 0b000));
        assert!(!wins(CoinSide::Heads, 3, 0b010));
        assert!(wins(CoinSide::Tails, 3, 0b111));
        assert!(!wins(CoinSide::Tails, 3, 0b011));
        assert_eq!(gross(1_000, CoinSide::Tails, 1, 1), 1_960);
        assert_eq!(gross(1_000, CoinSide::Heads, 2, 0), 3_920);
        assert_eq!(gross(1_000, CoinSide::Heads, 2, 2), 0);
        // Rounded down: 106 × 1.96 = 207.76.
        assert_eq!(gross(106, CoinSide::Heads, 1, 0), 207);
    }

    #[test]
    fn rtp_is_98_percent_for_every_count() {
        // One outcome in 2^flips wins.
        let stake = 1_000_000_000u64;
        for flips in 1..=MAX_FLIPS {
            let ev = gross_win(stake, flips) >> flips;
            assert_eq!(ev, 980_000_000, "{flips} flips");
        }
    }

    #[test]
    fn only_the_tossed_coins_are_set_and_each_side_is_even() {
        let mut rng = Rng::from_vrf([4; 32]);
        let mut tails = 0;
        for _ in 0..10_000 {
            let coins = toss(&mut rng, 10);
            assert!(coins < 1 << 10);
            tails += coins.count_ones();
        }
        // Expected 50 000 of 100 000; 5 sigma is about 790.
        assert!((49_200..=50_800).contains(&tails), "{tails}");
        assert!(toss(&mut rng, 3) < 1 << 3);
    }
}
