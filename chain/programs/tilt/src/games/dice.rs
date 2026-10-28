//! Dice: a roll from 00.00 to 99.99 (`0..10 000`); the player wins rolling under their target,
//! or at least their target when betting over. A win pays `98% / chance`: RTP 98.00% before
//! Tilt's fee, for every target.

use crate::games::{gain, to_u64};
use crate::rng::Rng;

/// Rolls are `0..ROLLS`, shown divided by 100.
pub const ROLLS: u16 = 10_000;
/// Winning rolls allowed: 1% to 98% chance.
pub const MIN_WINNING: u16 = 100;
pub const MAX_WINNING: u16 = 9_800;
/// A win returns `stake × RETURN_ROLLS / winning rolls` (98% of `ROLLS`).
const RETURN_ROLLS: u128 = 9_800;

/// How many rolls win: `target` under, `ROLLS − target` over. `None` outside 1%–98%.
pub fn winning_rolls(target: u16, over: bool) -> Option<u16> {
    let winning = if over {
        ROLLS.checked_sub(target)?
    } else {
        target
    };
    (MIN_WINNING..=MAX_WINNING)
        .contains(&winning)
        .then_some(winning)
}

pub fn roll(rng: &mut Rng) -> u16 {
    rng.below(ROLLS as u64) as u16
}

pub fn wins(target: u16, over: bool, roll: u16) -> bool {
    if over {
        roll >= target
    } else {
        roll < target
    }
}

/// What a win returns, rounded down. Needs a valid target.
pub fn gross_win(stake: u64, winning: u16) -> u128 {
    stake as u128 * RETURN_ROLLS / winning as u128
}

/// Most the round can gain, `None` for a target outside the rules.
pub fn max_gain(stake: u64, target: u16, over: bool) -> Option<u64> {
    let winning = winning_rolls(target, over)?;
    Some(gain(stake, gross_win(stake, winning)))
}

/// What `roll` returns. Needs a valid target.
pub fn gross(stake: u64, target: u16, over: bool, roll: u16) -> u64 {
    let winning = winning_rolls(target, over).expect("dice target checked at bet time");
    if wins(target, over, roll) {
        to_u64(gross_win(stake, winning))
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chances_outside_1_to_98_percent_are_refused() {
        assert_eq!(winning_rolls(100, false), Some(100));
        assert_eq!(winning_rolls(99, false), None);
        assert_eq!(winning_rolls(9_800, false), Some(9_800));
        assert_eq!(winning_rolls(9_801, false), None);
        assert_eq!(winning_rolls(9_900, true), Some(100));
        assert_eq!(winning_rolls(9_901, true), None);
        assert_eq!(winning_rolls(200, true), Some(9_800));
        assert_eq!(winning_rolls(199, true), None);
        assert_eq!(winning_rolls(10_001, true), None);
        assert_eq!(winning_rolls(u16::MAX, false), None);
        assert_eq!(max_gain(1_000, 0, false), None);
    }

    #[test]
    fn under_wins_below_the_target_over_wins_from_it() {
        assert!(wins(5_000, false, 4_999));
        assert!(!wins(5_000, false, 5_000));
        assert!(wins(5_000, true, 5_000));
        assert!(!wins(5_000, true, 4_999));
    }

    #[test]
    fn payouts() {
        // 50%: 1.96x.
        assert_eq!(gross(1_000, 5_000, false, 0), 1_960);
        assert_eq!(gross(1_000, 5_000, false, 5_000), 0);
        // 1%: 98x; 98%: 1x.
        assert_eq!(gross(1_000, 9_900, true, 9_999), 98_000);
        assert_eq!(gross(1_000, 9_800, false, 9_799), 1_000);
        // Rounded down: 106 × 9 800 / 3 333 = 311.67…
        assert_eq!(gross(106, 3_333, false, 0), 311);
        assert_eq!(max_gain(1_000, 9_900, true), Some(97_000));
        assert_eq!(max_gain(1_000, 9_800, false), Some(0));
        assert_eq!(max_gain(u64::MAX, 100, false), Some(u64::MAX));
    }

    #[test]
    fn rtp_is_98_percent_for_every_target() {
        // EV = winning / ROLLS × gross_win: exactly 98% before rounding down.
        let stake = 1_000_000_000u64;
        for target in 0..=ROLLS {
            for over in [false, true] {
                let Some(winning) = winning_rolls(target, over) else {
                    continue;
                };
                let ev = gross_win(stake, winning) * winning as u128 / ROLLS as u128;
                assert!(980_000_000 - ev <= 1, "target {target} over {over}: {ev}");
            }
        }
    }

    #[test]
    fn the_roll_covers_every_value() {
        let mut rng = Rng::from_vrf([5; 32]);
        let rolls: Vec<u16> = (0..100_000).map(|_| roll(&mut rng)).collect();
        assert!(rolls.iter().all(|&r| r < ROLLS));
        let under = rolls.iter().filter(|&&r| r < 5_000).count();
        // Expected 50 000; 5 sigma is about 790.
        assert!((49_200..=50_800).contains(&under), "{under}");
    }
}
