//! Game rules, independent of Solana: each game draws from an `Rng` and returns
//! what a finished round pays back for a stake (`gross`, before Tilt's fee).

pub mod baccarat;
pub mod blackjack;
pub mod dice;
pub mod flip;
pub mod hilo;
pub mod keno;
pub mod limbo;
pub mod mines;
pub mod quick;
pub mod roulette;
pub mod slots;
pub mod tower;
pub mod wheel;

/// The gain of a round whose best gross return is `best_gross`. Saturates like every game's
/// `max_gain`, so a huge stake is refused by `start_round` instead of panicking.
pub fn gain(stake: u64, best_gross: u128) -> u64 {
    u64::try_from(best_gross.saturating_sub(stake as u128)).unwrap_or(u64::MAX)
}

/// A gross return the round's checks already bound by the stake plus its `max_gain`.
pub fn to_u64(gross: u128) -> u64 {
    u64::try_from(gross).expect("gross exceeds u64")
}
