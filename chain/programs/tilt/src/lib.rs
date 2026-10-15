//! Tilt on-chain casino.
//!
//! - Money lives on Solana: a USDC vault, and a per-player ledger that only Solana writes.
//! - Play happens in a MagicBlock Ephemeral Rollup: each player account enters the rollup
//!   at its first deposit and stays there; rounds are balance updates with free VRF draws.
//! - Withdrawals are requested in the rollup and paid on Solana by a Magic Action that
//!   checks the claim against the ledger and holds anything unusual for review.
//!
//! See `chain/README.md` for the flows and `docs/spec.md` §6 for the decisions.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod games;
pub mod instructions;
pub mod rng;
pub mod settlement;
pub mod state;
pub mod withdrawals;

use games::{baccarat::BaccaratBet, roulette::RouletteBet};
use instructions::*;
use state::Config;

declare_id!("2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd");

#[ephemeral]
#[program]
pub mod tilt {
    use super::*;

    // House, on Solana.

    /// Only the program's upgrade authority can initialize; it becomes the admin.
    pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey, config: Config) -> Result<()> {
        instructions::admin::initialize(ctx, relayer, config)
    }

    pub fn set_config(ctx: Context<AdminVault>, config: Config) -> Result<()> {
        instructions::admin::set_config(ctx, config)
    }

    pub fn set_roles(ctx: Context<AdminVault>, admin: Pubkey, relayer: Pubkey) -> Result<()> {
        instructions::admin::set_roles(ctx, admin, relayer)
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        instructions::admin::fund_vault(ctx, amount)
    }

    pub fn withdraw_house(ctx: Context<WithdrawHouse>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_house(ctx, amount)
    }

    // Player accounts, on Solana.

    pub fn open_account(ctx: Context<OpenAccount>, amount: u64, max_win: u64) -> Result<()> {
        instructions::account::open_account(ctx, amount, max_win)
    }

    pub fn delegate_account(ctx: Context<DelegateAccount>) -> Result<()> {
        instructions::account::delegate_account(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::account::deposit(ctx, amount)
    }

    pub fn raise_win_cap(ctx: Context<RaiseWinCap>, amount: u64) -> Result<()> {
        instructions::account::raise_win_cap(ctx, amount)
    }

    pub fn open_table(ctx: Context<OpenTable>) -> Result<()> {
        instructions::table::open_table(ctx)
    }

    pub fn delegate_table(ctx: Context<DelegateTable>) -> Result<()> {
        instructions::table::delegate_table(ctx)
    }

    // Rounds, in the rollup.

    pub fn blackjack_bet(
        ctx: Context<Play>,
        amount: u64,
        hands: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::play::blackjack_bet(ctx, amount, hands, client_seed)
    }

    pub fn blackjack_hit(ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::blackjack_hit(ctx, client_seed)
    }

    pub fn blackjack_stand(ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::blackjack_stand(ctx, client_seed)
    }

    pub fn blackjack_double(ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::blackjack_double(ctx, client_seed)
    }

    pub fn blackjack_split(ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::blackjack_split(ctx, client_seed)
    }

    pub fn roulette_spin(
        ctx: Context<Play>,
        amount: u64,
        bet: RouletteBet,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::play::roulette_spin(ctx, amount, bet, client_seed)
    }

    pub fn baccarat_deal(
        ctx: Context<Play>,
        amount: u64,
        bet: BaccaratBet,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::play::baccarat_deal(ctx, amount, bet, client_seed)
    }

    pub fn slots_spin(ctx: Context<Play>, amount: u64, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::slots_spin(ctx, amount, client_seed)
    }

    pub fn expire_round(ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
        instructions::play::expire_round(ctx, client_seed)
    }

    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::play::consume_randomness(ctx, randomness, request_id)
    }

    // Withdrawals.

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::withdraw(ctx, amount)
    }

    pub fn pay_withdrawals(ctx: Context<PayWithdrawals>) -> Result<()> {
        instructions::withdraw::pay_withdrawals(ctx)
    }

    pub fn release_withdrawals(ctx: Context<ReleaseWithdrawals>) -> Result<()> {
        instructions::withdraw::release_withdrawals(ctx)
    }

    // Releasing player losses from the vault reservation.

    pub fn checkpoint(ctx: Context<Checkpoint>) -> Result<()> {
        instructions::withdraw::checkpoint(ctx)
    }

    pub fn apply_checkpoint(ctx: Context<ApplyCheckpoint>) -> Result<()> {
        instructions::withdraw::apply_checkpoint(ctx)
    }

    // Promo payouts (sponsor prize pools), on Solana.

    pub fn init_promo(ctx: Context<InitPromo>, config: PromoConfig) -> Result<()> {
        instructions::promo::init_promo(ctx, config)
    }

    pub fn set_promo(ctx: Context<SetPromo>, config: PromoConfig) -> Result<()> {
        instructions::promo::set_promo(ctx, config)
    }

    pub fn fund_promo(ctx: Context<FundPromo>, amount: u64) -> Result<()> {
        instructions::promo::fund_promo(ctx, amount)
    }

    pub fn pay_promo(ctx: Context<PayPromo>, payout_id: [u8; 16], amount: u64) -> Result<()> {
        instructions::promo::pay_promo(ctx, payout_id, amount)
    }

    pub fn withdraw_promo(ctx: Context<WithdrawPromo>, amount: u64) -> Result<()> {
        instructions::promo::withdraw_promo(ctx, amount)
    }
}
