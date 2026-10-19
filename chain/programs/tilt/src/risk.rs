//! The house's risk pool: the bankroll set aside for what open rounds may still win, and for
//! wins not yet secured on Solana. Rounds are independent (one VRF draw each) and none
//! returns more than 99% of its stake on average, whatever the player does, so the pool
//! holds what covers all open rounds at once except with probability `EPSILON` (Bernstein's
//! inequality), never more than their worst case added up.

use anchor_lang::prelude::*;

use crate::errors::TiltError;

/// ln(1 / ε) for ε = 10⁻⁹, rounded up (20.7233… → 20.724), in thousandths: the pool falls
/// short at most once in a billion.
const LN_INV_EPSILON_MILLI: u128 = 20_724;
const MILLI: u128 = 1_000;
/// Highest return of any game, in percent of the stake (Mines; the others return less).
const MAX_RETURN_PERCENT: u128 = 99;
const PERCENT: u128 = 100;

/// What an open round puts on the pool: the part of its worst case the player's secured wins
/// do not already cover (`gain`), and its stake. `gain` is at most `max_round_gain`.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq, Debug,
)]
pub struct Pooled {
    pub gain: u64,
    pub stake: u64,
}

impl Pooled {
    /// The round's share of the variance bound: the pool loses at most `gain` on it and
    /// 0.99 × `stake` on average, so E[loss²] ≤ gain × 0.99 × stake.
    fn exposure(self) -> u128 {
        self.gain as u128 * self.stake as u128
    }
}

/// Lives in the rollup (delegated once), next to the player accounts. Every round that puts
/// something on the pool reprices it at its start (`reprice`) and takes it off at its end
/// (`close`): the bankroll it needed is free again at once.
#[account]
#[derive(InitSpace, Default)]
pub struct RiskPool {
    pub bump: u8,
    /// Open rounds: Σ `gain`, Σ `stake` and Σ `gain × stake`.
    pub gains: u128,
    pub stakes: u128,
    pub exposure: u128,
    /// Players' net wins the pool pays and Solana has not secured yet (Σ their `uncovered`).
    pub uncovered: u64,
    /// Total moved from the pool to players' secured wins (`secure`); never decreases.
    /// Solana mirrors it in `Vault::pool_transferred`.
    pub transferred: u64,
}

impl RiskPool {
    /// Replaces an open round's `old` share with `new` (a new round from nothing, a split or
    /// a double from its earlier share), unless the pool would then hold more than `line`
    /// (the bankroll Solana granted it, `Vault::pool_line`) allows: refused, nothing changes.
    pub fn reprice(
        &mut self,
        old: Pooled,
        new: Pooled,
        line: u64,
        max_round_gain: u64,
    ) -> Result<()> {
        let gains = self.gains - old.gain as u128 + new.gain as u128;
        let stakes = self.stakes - old.stake as u128 + new.stake as u128;
        let exposure = self.exposure - old.exposure() + new.exposure();
        let needed = required_reserve(gains, stakes, exposure, max_round_gain)
            .and_then(|reserve| reserve.checked_add(self.uncovered as u128))
            .and_then(|needed| needed.checked_add(self.transferred as u128));
        require!(
            needed.is_some_and(|needed| needed <= line as u128),
            TiltError::RiskPoolFull
        );
        (self.gains, self.stakes, self.exposure) = (gains, stakes, exposure);
        Ok(())
    }

    /// Takes a settled round's share off the pool.
    pub fn close(&mut self, pooled: Pooled) {
        self.gains -= pooled.gain as u128;
        self.stakes -= pooled.stake as u128;
        self.exposure -= pooled.exposure();
    }

    /// A player's uncovered wins went from `old` to `new` (a round settled).
    pub fn recover(&mut self, old: u64, new: u64) {
        self.uncovered = self.uncovered - old + new;
    }

    /// `amount` of a player's uncovered wins becomes secured on Solana (a withdrawal).
    pub fn secure(&mut self, amount: u64) {
        self.uncovered -= amount;
        self.transferred += amount;
    }
}

/// What the pool must hold for open rounds of total worst case `gains`, total stake `stakes`
/// and total `exposure` (Σ gain × stake), none gaining more than `max_gain`: their losses add
/// up past it with probability at most ε. `None` past u128 (refused upstream: fail closed).
///
/// Each round's loss X_i lies in [0, gain_i] with E[X_i] ≤ 0.99 stake_i and
/// E[X_i²] ≤ gain_i × 0.99 stake_i. Bernstein's inequality bounds
/// P(Σ X_i ≥ Σ E[X_i] + t) by exp(−t² / (2σ² + 2Mt/3)) with σ² = 0.99 Σ gain_i stake_i and
/// M = `max_gain`; it equals ε for t = (b + √(b² + 4c)) / 2, b = 2 ln(1/ε) M / 3,
/// c = 2 ln(1/ε) σ². Every step rounds up.
pub fn required_reserve(gains: u128, stakes: u128, exposure: u128, max_gain: u64) -> Option<u128> {
    if gains == 0 {
        return Some(0);
    }
    let mean = div_ceil(stakes.checked_mul(MAX_RETURN_PERCENT)?, PERCENT);
    let b = div_ceil(2 * LN_INV_EPSILON_MILLI * max_gain as u128, 3 * MILLI);
    let c = div_ceil(
        exposure.checked_mul(2 * LN_INV_EPSILON_MILLI * MAX_RETURN_PERCENT)?,
        MILLI * PERCENT,
    );
    let discriminant = b.checked_mul(b)?.checked_add(c.checked_mul(4)?)?;
    let t = div_ceil(b.checked_add(sqrt_ceil(discriminant))?, 2);
    // Bernstein is loose for a few rounds: never more than all of them lost at once.
    Some(mean.checked_add(t)?.min(gains))
}

fn div_ceil(numerator: u128, denominator: u128) -> u128 {
    numerator.div_ceil(denominator)
}

fn sqrt_ceil(n: u128) -> u128 {
    let root = n.isqrt();
    if root * root == n {
        root
    } else {
        root + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    /// `n` open rounds of `stake`, each able to gain `gain`.
    fn reserve_for(n: u128, stake: u64, gain: u64) -> u128 {
        let pooled = Pooled { gain, stake };
        required_reserve(
            n * gain as u128,
            n * stake as u128,
            n * pooled.exposure(),
            gain,
        )
        .unwrap()
    }

    #[test]
    fn nothing_open_needs_nothing() {
        assert_eq!(required_reserve(0, 0, 0, 2_500 * USDC), Some(0));
    }

    #[test]
    fn a_few_rounds_hold_their_whole_worst_case() {
        // One round can lose its whole gain: Bernstein alone would ask for ~14× that.
        assert_eq!(
            reserve_for(1, 10 * USDC, 2_500 * USDC),
            2_500 * USDC as u128
        );
        assert_eq!(
            reserve_for(10, 10 * USDC, 2_500 * USDC),
            25_000 * USDC as u128
        );
    }

    #[test]
    fn many_rounds_hold_far_less_than_their_worst_case() {
        // 1 000 rounds of 10 USDC able to gain 2 500 each: 2.5 M worst case.
        let reserve = reserve_for(1_000, 10 * USDC, 2_500 * USDC);
        let usdc = reserve / USDC as u128;
        // Mean 9 900 + t ≈ 53 800 (checked against the closed form with f64).
        assert!((63_000..64_500).contains(&usdc), "{usdc}");
        // Grows like √n, not n: 100 times the rounds, about 10 times the reserve.
        let many = reserve_for(100_000, 10 * USDC, 2_500 * USDC) / USDC as u128;
        assert!(many < 10 * usdc + 990_000, "{many}");
    }

    #[test]
    fn the_reserve_covers_the_tail_it_claims() {
        // Exact tail for the riskiest strategy at a 251× payout (every round wins the whole
        // gain with probability 0.99 × stake / (stake + gain)): binomial, n = 1 000.
        let (n, stake, gain) = (1_000u32, 10 * USDC, 2_500 * USDC);
        let p = 0.99 * stake as f64 / (stake + gain) as f64;
        let reserve = reserve_for(n.into(), stake, gain);
        // Smallest number of wins k with gain × k above the reserve.
        let k = (reserve / gain as u128 + 1) as u32;
        let mut tail = 0.0f64;
        let mut pmf = (1.0 - p).powi(n as i32);
        for i in 0..=n {
            if i >= k {
                tail += pmf;
            }
            pmf *= (n - i) as f64 / (i + 1) as f64 * p / (1.0 - p);
        }
        assert!(tail <= 1e-9, "P(loss > reserve) = {tail}");
    }

    #[test]
    fn huge_values_fail_closed_instead_of_overflowing() {
        assert_eq!(required_reserve(1, u128::MAX, 1, u64::MAX), None);
        assert_eq!(required_reserve(1, 1, u128::MAX, u64::MAX), None);
    }

    fn pool() -> RiskPool {
        RiskPool::default()
    }

    #[test]
    fn a_round_is_refused_when_the_line_cannot_hold_it() {
        let round = Pooled {
            gain: 2_500 * USDC,
            stake: 10 * USDC,
        };
        let mut p = pool();
        assert_eq!(
            p.reprice(Pooled::default(), round, 2_500 * USDC - 1, 2_500 * USDC),
            Err(TiltError::RiskPoolFull.into())
        );
        let mut p = pool();
        p.reprice(Pooled::default(), round, 2_500 * USDC, 2_500 * USDC)
            .unwrap();
        // Wins the pool already pays and wins it moved to Solana use the line up too.
        let mut p = RiskPool {
            uncovered: 1,
            ..pool()
        };
        assert!(p
            .reprice(Pooled::default(), round, 2_500 * USDC, 2_500 * USDC)
            .is_err());
        let mut p = RiskPool {
            transferred: 1,
            ..pool()
        };
        assert!(p
            .reprice(Pooled::default(), round, 2_500 * USDC, 2_500 * USDC)
            .is_err());
    }

    #[test]
    fn a_settled_round_frees_exactly_what_it_held() {
        let mut p = pool();
        let a = Pooled {
            gain: 700,
            stake: 30,
        };
        let b = Pooled {
            gain: 900,
            stake: 50,
        };
        p.reprice(Pooled::default(), a, u64::MAX, 1_000).unwrap();
        p.reprice(Pooled::default(), b, u64::MAX, 1_000).unwrap();
        // A split or double replaces the round's share, never adds a second one.
        let bigger = Pooled {
            gain: 1_000,
            stake: 60,
        };
        p.reprice(b, bigger, u64::MAX, 1_000).unwrap();
        p.close(bigger);
        p.close(a);
        assert_eq!((p.gains, p.stakes, p.exposure), (0, 0, 0));
    }

    #[test]
    fn securing_moves_wins_from_uncovered_to_transferred() {
        let mut p = pool();
        p.recover(0, 500);
        p.recover(500, 300);
        p.secure(300);
        assert_eq!((p.uncovered, p.transferred), (0, 300));
    }
}
