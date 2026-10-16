//! Keno: the player picks 1 to 10 numbers out of 1..=40, 10 distinct numbers are drawn, and
//! the paytable for the number of picks pays by hits. Every paytable's exact RTP (hypergeometric,
//! computed in the tests) is between 97.90% and 98.00% before Tilt's fee.

use crate::games::{gain, to_u64};
use crate::rng::Rng;

pub const NUMBERS: u8 = 40;
pub const DRAWN: usize = 10;
pub const MAX_PICKS: usize = 10;

/// Stake multiples ×100 by hits (0 to n), for n = 1 to 10 picks (`PAYTABLES[n − 1]`).
pub const PAYTABLES: [&[u64]; MAX_PICKS] = [
    &[0, 392],
    &[0, 170, 565],
    &[0, 80, 210, 2_800],
    &[0, 75, 160, 480, 5_000],
    &[0, 25, 140, 390, 1_450, 10_000],
    &[0, 0, 100, 350, 700, 1_870, 20_000],
    &[0, 0, 50, 290, 440, 1_400, 3_200, 30_000],
    &[0, 0, 0, 210, 420, 1_200, 2_900, 8_300, 50_000],
    &[0, 0, 0, 150, 300, 800, 1_500, 5_800, 15_000, 75_000],
    &[0, 0, 0, 140, 220, 440, 790, 2_000, 5_400, 24_700, 100_000],
];

/// The paytable for `picks` numbers. Needs 1 to 10 picks.
pub fn paytable(picks: usize) -> &'static [u64] {
    PAYTABLES[picks - 1]
}

/// 1 to 10 distinct numbers, each in 1..=40.
pub fn is_valid(picks: &[u8]) -> bool {
    (1..=MAX_PICKS).contains(&picks.len())
        && picks.iter().all(|n| (1..=NUMBERS).contains(n))
        && picks
            .iter()
            .enumerate()
            .all(|(i, n)| !picks[..i].contains(n))
}

/// Draws 10 distinct numbers: the first 10 steps of a Fisher–Yates shuffle of 1..=40
/// (step `i` swaps position `i` with `i + rng.below(40 − i)`).
pub fn draw(rng: &mut Rng) -> [u8; DRAWN] {
    let mut pool: [u8; NUMBERS as usize] = core::array::from_fn(|i| i as u8 + 1);
    for i in 0..DRAWN {
        let j = i + rng.below((NUMBERS as usize - i) as u64) as usize;
        pool.swap(i, j);
    }
    core::array::from_fn(|i| pool[i])
}

pub fn hits(picks: &[u8], drawn: &[u8; DRAWN]) -> u8 {
    picks.iter().filter(|n| drawn.contains(n)).count() as u8
}

/// Most the round can gain, `None` for picks outside the rules.
pub fn max_gain(stake: u64, picks: &[u8]) -> Option<u64> {
    if !is_valid(picks) {
        return None;
    }
    let best = *paytable(picks.len())
        .iter()
        .max()
        .expect("non-empty paytable");
    Some(gain(stake, stake as u128 * best as u128 / 100))
}

/// What `hits` hits return with `picks` numbers picked, rounded down.
pub fn gross(stake: u64, picks: usize, hits: u8) -> u64 {
    to_u64(stake as u128 * paytable(picks)[hits as usize] as u128 / 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choose(n: u128, k: u128) -> u128 {
        if k > n {
            return 0;
        }
        (0..k).fold(1, |c, i| c * (n - i) / (i + 1))
    }

    #[test]
    fn every_paytable_returns_97_90_to_98_00_percent_exactly() {
        let all = choose(NUMBERS as u128, DRAWN as u128);
        for picks in 1..=MAX_PICKS as u128 {
            let table = paytable(picks as usize);
            assert_eq!(table.len() as u128, picks + 1);
            // Σ P(h) × m(h) / 100 with P(h) = C(n, h) C(40 − n, 10 − h) / C(40, 10).
            let returned: u128 = (0..=picks)
                .map(|h| {
                    choose(picks, h)
                        * choose(NUMBERS as u128 - picks, DRAWN as u128 - h)
                        * table[h as usize] as u128
                })
                .sum();
            // 97.90% ≤ returned / (100 × all) ≤ 98.00%.
            assert!(returned * 10_000 >= 9_790 * 100 * all, "{picks} picks");
            assert!(returned * 10_000 <= 9_800 * 100 * all, "{picks} picks");
        }
    }

    #[test]
    fn more_hits_pay_more_and_the_top_prize_grows_to_1_000x() {
        for (i, table) in PAYTABLES.iter().enumerate() {
            assert!(table.windows(2).all(|w| w[0] <= w[1]), "{} picks", i + 1);
            assert_eq!(table[0], 0);
        }
        let tops: Vec<u64> = PAYTABLES.iter().map(|t| *t.last().unwrap()).collect();
        assert!(tops.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(tops[MAX_PICKS - 1], 100_000);
    }

    #[test]
    fn refused_picks() {
        assert!(is_valid(&[1]) && is_valid(&[40, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
        assert!(!is_valid(&[]));
        assert!(!is_valid(&[0]));
        assert!(!is_valid(&[41]));
        assert!(!is_valid(&[3, 3]));
        assert!(!is_valid(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
        assert_eq!(max_gain(1_000, &[5, 5]), None);
        assert_eq!(max_gain(1_000, &[5]), Some(2_920));
        assert_eq!(
            max_gain(1_000, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
            Some(999_000)
        );
    }

    #[test]
    fn the_draw_is_10_distinct_numbers_from_1_to_40() {
        let mut rng = Rng::from_vrf([6; 32]);
        let mut counts = [0u32; NUMBERS as usize];
        for _ in 0..40_000 {
            let drawn = draw(&mut rng);
            assert!(is_valid(&drawn));
            for n in drawn {
                counts[n as usize - 1] += 1;
            }
        }
        // Each number is drawn with probability 1/4: expected 10 000; 5 sigma is about 430.
        for c in counts {
            assert!((9_550..=10_450).contains(&c), "{c}");
        }
    }

    #[test]
    fn payouts_count_the_hits() {
        let drawn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert_eq!(hits(&[1, 2, 40], &drawn), 2);
        assert_eq!(gross(1_000, 3, 2), 2_100);
        assert_eq!(gross(1_000, 3, 1), 800);
        assert_eq!(gross(1_000, 1, 0), 0);
        // Rounded down: 106 × 3.92 = 415.52.
        assert_eq!(gross(106, 1, 1), 415);
    }
}
