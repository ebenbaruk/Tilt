//! Limbo: the player picks a target multiplier; one draw gives a result multiplier with
//! `P(result ≥ x) = 0.98 / x`, and the round pays the target when the result reaches it.
//! Multipliers are integers ×100 (`250` = 2.50×). RTP 98.00% up to rounding down, never above.

use crate::games::{gain, to_u64};
use crate::rng::Rng;

/// Targets from 1.01× to 10 000×.
pub const MIN_TARGET: u32 = 101;
pub const MAX_TARGET: u32 = 1_000_000;
/// Results from 1.00× to 1 000 000×.
pub const MIN_RESULT: u64 = 100;
pub const MAX_RESULT: u64 = 100_000_000;
/// The draw `v` is uniform in `1..=SPAN`.
const SPAN: u64 = 1 << 32;
/// 98% (×100): `result = RETURN × SPAN / v`.
const RETURN: u64 = 98;

pub fn is_valid(target: u32) -> bool {
    (MIN_TARGET..=MAX_TARGET).contains(&target)
}

/// The result multiplier (×100): `clamp(floor(98 × 2^32 / v), 1.00×, 1 000 000×)`.
pub fn result(rng: &mut Rng) -> u32 {
    let v = rng.below(SPAN) + 1;
    (RETURN * SPAN / v).clamp(MIN_RESULT, MAX_RESULT) as u32
}

pub fn gross_win(stake: u64, target: u32) -> u128 {
    stake as u128 * target as u128 / 100
}

/// Most the round can gain, `None` for a target outside the rules.
pub fn max_gain(stake: u64, target: u32) -> Option<u64> {
    is_valid(target).then(|| gain(stake, gross_win(stake, target)))
}

pub fn gross(stake: u64, target: u32, result: u32) -> u64 {
    if result >= target {
        to_u64(gross_win(stake, target))
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `P(result ≥ target)` as `winning / SPAN`: the draws `v ≤ 98 × 2^32 / target`.
    fn winning_draws(target: u32) -> u64 {
        RETURN * SPAN / target as u64
    }

    #[test]
    fn targets_outside_1_01_to_10_000x_are_refused() {
        assert!(!is_valid(100) && !is_valid(1_000_001) && !is_valid(0));
        assert!(is_valid(101) && is_valid(1_000_000));
        assert_eq!(max_gain(1_000, 100), None);
        assert_eq!(max_gain(1_000, 200), Some(1_000));
        assert_eq!(max_gain(1_000, 1_000_000), Some(9_999_000));
    }

    #[test]
    fn results_span_1x_to_a_million_x() {
        // v = 2^32 gives 0.98×, shown as the 1.00× floor; v = 1 gives 4.2e9×, clamped.
        assert_eq!((RETURN * SPAN / SPAN).clamp(MIN_RESULT, MAX_RESULT), 100);
        assert_eq!((RETURN * SPAN).clamp(MIN_RESULT, MAX_RESULT), MAX_RESULT);
        let mut rng = Rng::from_vrf([3; 32]);
        for _ in 0..10_000 {
            let r = result(&mut rng) as u64;
            assert!((MIN_RESULT..=MAX_RESULT).contains(&r));
        }
    }

    #[test]
    fn a_result_reaching_the_target_pays_it() {
        assert_eq!(gross(1_000, 200, 200), 2_000);
        assert_eq!(gross(1_000, 200, 199), 0);
        assert_eq!(gross(1_000, 153, 10_000), 1_530);
        // Rounded down: 106 × 1.01 = 107.06.
        assert_eq!(gross(106, 101, 101), 107);
    }

    #[test]
    fn the_result_reaches_the_target_exactly_on_the_winning_draws() {
        for target in [101u32, 200, 333, 1_000_000] {
            let edge = winning_draws(target);
            assert!(RETURN * SPAN / edge >= target as u64);
            assert!(RETURN * SPAN / (edge + 1) < target as u64);
        }
    }

    #[test]
    fn rtp_is_at_most_98_percent_and_never_far_below() {
        // EV / stake = winning / 2^32 × target / 100: ≤ 0.98, short of it by under 0.0003%.
        for target in (MIN_TARGET..=MAX_TARGET).step_by(997).chain([MAX_TARGET]) {
            let ev = winning_draws(target) as u128 * target as u128; // × 1 / (100 × 2^32)
            let full = 98 * SPAN as u128;
            assert!(ev <= full, "target {target}");
            assert!(full - ev <= target as u128, "target {target}");
        }
    }

    #[test]
    fn half_the_results_reach_1_96x() {
        let mut rng = Rng::from_vrf([8; 32]);
        let n = 100_000;
        let wins = (0..n).filter(|_| result(&mut rng) >= 196).count();
        // Expected 50 000; 5 sigma is about 790.
        assert!((49_200..=50_800).contains(&wins), "{wins}");
    }
}
