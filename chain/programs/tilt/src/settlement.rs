//! Money rules shared by every game.

/// Tilt keeps 1% of what each winning round gains (never of the stake, never on losses or pushes).
pub const FEE_BPS: u64 = 100;
/// Least fee on a winning round: 1% of a gain under 100 units rounds to nothing, and some games
/// gain that little (Limbo 1.01×, a hedged roulette spin), while Tilt still pays the round.
pub const MIN_FEE: u64 = 1;
pub const BPS: u64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settlement {
    /// What goes back to the player's balance: stake + gain - fee, or less on a loss.
    pub payout: u64,
    pub fee: u64,
}

/// `gross` is what the game returns for `stake` before Tilt's fee (0 on a loss, `stake` on a push).
pub fn settle(stake: u64, gross: u64) -> Settlement {
    if gross <= stake {
        return Settlement {
            payout: gross,
            fee: 0,
        };
    }
    let gain = gross - stake;
    // At most the gain (at least 1 here): a win never pays back less than the stake.
    let fee = (gain * FEE_BPS / BPS).max(MIN_FEE);
    Settlement {
        payout: gross - fee,
        fee,
    }
}

/// `stake * numerator / denominator`, rounded down, without intermediate overflow. A result
/// beyond u64 panics like any other overflow here (`overflow-checks`), never wraps.
pub fn mul_div(stake: u64, numerator: u64, denominator: u64) -> u64 {
    u64::try_from(stake as u128 * numerator as u128 / denominator as u128)
        .expect("mul_div result exceeds u64")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_one_percent_of_the_gain_only() {
        assert_eq!(
            settle(1_000_000, 2_000_000),
            Settlement {
                payout: 1_990_000,
                fee: 10_000
            }
        );
    }

    #[test]
    fn no_fee_on_push_or_loss() {
        assert_eq!(
            settle(1_000_000, 1_000_000),
            Settlement {
                payout: 1_000_000,
                fee: 0
            }
        );
        assert_eq!(settle(1_000_000, 0), Settlement { payout: 0, fee: 0 });
    }

    #[test]
    fn fee_rounds_down_in_the_players_favour() {
        assert_eq!(settle(1_000, 1_199).fee, 1);
        assert_eq!(settle(1_000, 1_299).fee, 2);
    }

    #[test]
    fn every_win_pays_a_fee_and_at_least_the_stake() {
        // Under 100 units of gain, 1% rounds to nothing: the fee is 1 unit.
        assert_eq!(settle(1_000, 1_099).fee, 1);
        assert_eq!(
            settle(1_000, 1_001),
            Settlement {
                payout: 1_000,
                fee: 1
            }
        );
        for stake in [1, 106, 1_000, 99_999] {
            for gross in stake + 1..stake + 300 {
                let s = settle(stake, gross);
                assert!(s.fee >= 1 && s.payout >= stake, "{stake} -> {gross}");
                assert_eq!(s.payout + s.fee, gross);
            }
        }
    }

    #[test]
    fn mul_div_handles_large_values() {
        assert_eq!(mul_div(u64::MAX / 2, 4, 2), u64::MAX - 1);
    }

    #[test]
    #[should_panic(expected = "mul_div result exceeds u64")]
    fn mul_div_never_truncates() {
        mul_div(u64::MAX, 5, 2);
    }
}
