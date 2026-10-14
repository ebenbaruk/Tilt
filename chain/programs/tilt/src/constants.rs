pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_TOKEN_SEED: &[u8] = b"vault_token";
pub const ACCOUNT_SEED: &[u8] = b"account";
pub const LEDGER_SEED: &[u8] = b"ledger";
/// The blackjack table. `b"table"` held the 6-hand layout; delegated accounts cannot be
/// resized, so the 10-hand table lives under a new seed and the old ones are abandoned.
pub const TABLE_SEED: &[u8] = b"bjtable";
pub const PROMO_SEED: &[u8] = b"promo";
pub const PROMO_TOKEN_SEED: &[u8] = b"promo_token";
pub const PAYOUT_SEED: &[u8] = b"payout";
/// Escrow index used for Magic Action fees (the SDK default).
pub const ACTION_ESCROW_INDEX: u8 = 255;
pub const DAY_SECS: i64 = 86_400;
