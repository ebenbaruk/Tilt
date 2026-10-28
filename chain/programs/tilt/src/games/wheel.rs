//! Wheel: 10 to 50 segments, each with a multiplier set by the risk; one draw picks the
//! segment. Every wheel's multipliers sum to exactly `0.98 × segments`: RTP 98.00% before
//! Tilt's fee.

use anchor_lang::prelude::*;

use crate::games::{gain, to_u64};
use crate::rng::Rng;

pub const SEGMENTS: [u8; 5] = [10, 20, 30, 40, 50];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum WheelRisk {
    /// Many small wins and a few empty segments.
    Low,
    /// Every other segment empty, bigger wins.
    Medium,
    /// One segment pays the whole wheel.
    High,
}

/// Low risk: this block of 10 repeats around the wheel (×100).
const LOW: [u64; 10] = [140, 120, 120, 120, 0, 120, 120, 120, 120, 0];
/// Medium risk: the odd segments' multipliers (×100) for 10 to 50 segments; even ones pay 0.
const MEDIUM: [&[u64]; 5] = [
    &[190, 150, 200, 140, 300],
    &[150, 200, 150, 200, 150, 200, 150, 200, 160, 400],
    &[
        150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 190, 500,
    ],
    &[
        150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200,
        170, 600,
    ],
    &[
        150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200, 150, 200,
        150, 200, 150, 200, 150, 200, 700,
    ],
];
/// Every wheel returns `RETURN_PER_SEGMENT × segments` (×100) in total.
const RETURN_PER_SEGMENT: u64 = 98;

pub fn is_valid(segments: u8) -> bool {
    SEGMENTS.contains(&segments)
}

/// Multiplier ×100 of `segment`. Needs valid `segments` and `segment < segments`.
pub fn multiplier(risk: WheelRisk, segments: u8, segment: u8) -> u64 {
    match risk {
        WheelRisk::Low => LOW[segment as usize % LOW.len()],
        WheelRisk::Medium if segment % 2 == 0 => 0,
        WheelRisk::Medium => MEDIUM[segments as usize / 10 - 1][segment as usize / 2],
        WheelRisk::High if segment == segments - 1 => RETURN_PER_SEGMENT * segments as u64,
        WheelRisk::High => 0,
    }
}

/// Every segment's multiplier ×100, in order. Needs valid `segments`.
pub fn multipliers(risk: WheelRisk, segments: u8) -> impl Iterator<Item = u64> {
    (0..segments).map(move |segment| multiplier(risk, segments, segment))
}

pub fn spin(rng: &mut Rng, segments: u8) -> u8 {
    rng.below(segments as u64) as u8
}

/// Most the round can gain, `None` for a wheel outside the rules.
pub fn max_gain(stake: u64, risk: WheelRisk, segments: u8) -> Option<u64> {
    if !is_valid(segments) {
        return None;
    }
    let best = multipliers(risk, segments).max().expect("non-empty wheel");
    Some(gain(stake, stake as u128 * best as u128 / 100))
}

pub fn gross(stake: u64, risk: WheelRisk, segments: u8, segment: u8) -> u64 {
    to_u64(stake as u128 * multiplier(risk, segments, segment) as u128 / 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RISKS: [WheelRisk; 3] = [WheelRisk::Low, WheelRisk::Medium, WheelRisk::High];

    #[test]
    fn every_wheel_returns_exactly_98_percent() {
        for risk in RISKS {
            for segments in SEGMENTS {
                assert_eq!(
                    multipliers(risk, segments).sum::<u64>(),
                    RETURN_PER_SEGMENT * segments as u64,
                    "{risk:?} {segments}"
                );
            }
        }
        for (i, wins) in MEDIUM.iter().enumerate() {
            assert_eq!(wins.len(), SEGMENTS[i] as usize / 2);
        }
    }

    #[test]
    fn risk_shapes_the_wheel() {
        let low: Vec<u64> = multipliers(WheelRisk::Low, 10).collect();
        assert_eq!(low, LOW);
        assert_eq!(
            multipliers(WheelRisk::Medium, 10).collect::<Vec<_>>(),
            [0, 190, 0, 150, 0, 200, 0, 140, 0, 300]
        );
        let high: Vec<u64> = multipliers(WheelRisk::High, 50).collect();
        assert_eq!(high.iter().filter(|&&m| m > 0).count(), 1);
        assert_eq!(high[49], 4_900);
        // The top prize grows with the wheel.
        for risk in [WheelRisk::Medium, WheelRisk::High] {
            let tops: Vec<u64> = SEGMENTS
                .iter()
                .map(|&s| multipliers(risk, s).max().unwrap())
                .collect();
            assert!(tops.windows(2).all(|w| w[0] < w[1]), "{risk:?}");
        }
    }

    #[test]
    fn refused_wheels_and_max_gain() {
        for segments in [0, 9, 11, 60, u8::MAX] {
            assert_eq!(max_gain(1_000, WheelRisk::Low, segments), None);
        }
        assert_eq!(max_gain(1_000, WheelRisk::Low, 10), Some(400));
        assert_eq!(max_gain(1_000, WheelRisk::Medium, 50), Some(6_000));
        assert_eq!(max_gain(1_000, WheelRisk::High, 50), Some(48_000));
    }

    #[test]
    fn payouts() {
        assert_eq!(gross(1_000, WheelRisk::High, 10, 9), 9_800);
        assert_eq!(gross(1_000, WheelRisk::High, 10, 8), 0);
        assert_eq!(gross(1_000, WheelRisk::Low, 20, 10), 1_400);
        assert_eq!(gross(1_000, WheelRisk::Medium, 30, 29), 5_000);
        // Rounded down: 106 × 1.2 = 127.2.
        assert_eq!(gross(106, WheelRisk::Low, 10, 1), 127);
    }

    #[test]
    fn every_segment_comes_up() {
        let mut rng = Rng::from_vrf([7; 32]);
        let mut counts = [0u32; 50];
        for _ in 0..50_000 {
            counts[spin(&mut rng, 50) as usize] += 1;
        }
        // Expected 1 000 each; 5 sigma is about 160.
        assert!(
            counts.iter().all(|c| (840..=1_160).contains(c)),
            "{counts:?}"
        );
    }
}
