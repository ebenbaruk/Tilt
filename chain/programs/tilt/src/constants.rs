pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_TOKEN_SEED: &[u8] = b"vault_token";
pub const ACCOUNT_SEED: &[u8] = b"account";
pub const LEDGER_SEED: &[u8] = b"ledger";
/// The blackjack table. `b"table"` held the 6-hand layout; delegated accounts cannot be
/// resized, so the 10-hand table lives under a new seed and the old ones are abandoned.
pub const TABLE_SEED: &[u8] = b"bjtable";
/// The player's Mines board.
pub const MINES_SEED: &[u8] = b"mines";
/// The player's last one-draw round (Dice, Limbo, Flip, Keno, Wheel).
pub const QUICK_SEED: &[u8] = b"quick";
/// The player's Hilo board.
pub const HILO_SEED: &[u8] = b"hilo";
/// The player's Tower board.
pub const TOWER_SEED: &[u8] = b"tower";
/// The player's last multi-chip roulette spin (`roulette_chips`).
pub const ROULETTE_SEED: &[u8] = b"roulette";
/// The house's risk pool (`risk::RiskPool`), one for every player.
pub const RISK_POOL_SEED: &[u8] = b"risk_pool";
pub const PROMO_SEED: &[u8] = b"promo";
pub const PROMO_TOKEN_SEED: &[u8] = b"promo_token";
pub const PAYOUT_SEED: &[u8] = b"payout";
/// Escrow index used for Magic Action fees (the SDK default).
pub const ACTION_ESCROW_INDEX: u8 = 255;
pub const DAY_SECS: i64 = 86_400;
/// Lowest `Config::min_bet` accepted: 0.1 USDC, in base units (6 decimals).
pub const MIN_BET_FLOOR: u64 = 100_000;
/// Shortest `Config::round_timeout_secs`. A retried draw abandons the pending VRF request; if
/// that request could still be answered, a relay seeing an unwanted answer coming could retry
/// until it liked the draw. The audit (2026-11-08, E3) puts a queued request's life at about
/// two minutes.
pub const MIN_ROUND_TIMEOUT_SECS: i64 = 120;
