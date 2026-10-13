use anchor_lang::prelude::*;

#[error_code]
pub enum TiltError {
    #[msg("Amount out of range")]
    AmountOutOfRange,
    #[msg("First deposit must exceed the onboarding fee")]
    DepositTooSmall,
    #[msg("Account has no deposit")]
    NoDeposit,
    #[msg("Vault cannot cover this")]
    VaultTooSmall,
    #[msg("A round is already in progress")]
    RoundInProgress,
    #[msg("Instruction not valid in the current round state")]
    WrongState,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Lifetime win cap reached")]
    WinCapReached,
    #[msg("This bet could win more than one round allows")]
    RoundGainTooHigh,
    #[msg("Invalid bet")]
    InvalidBet,
    #[msg("Round has not expired yet")]
    RoundNotExpired,
    #[msg("Rollup claim inconsistent with Solana's ledger")]
    FraudSuspected,
    #[msg("Paused")]
    Paused,
    #[msg("Max win above the allowed limit")]
    MaxWinTooHigh,
    #[msg("Withdrawal below the minimum")]
    WithdrawalTooSmall,
    #[msg("No loss to release")]
    NothingToCheckpoint,
    #[msg("Randomness does not answer the pending request")]
    StaleRandomness,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Promo payout above the pool's limits")]
    PromoCapReached,
}
