//! Game rules, independent of Solana: each game draws from an `Rng` and returns
//! what a finished round pays back for a stake (`gross`, before Tilt's fee).

pub mod baccarat;
pub mod blackjack;
pub mod mines;
pub mod roulette;
pub mod slots;
