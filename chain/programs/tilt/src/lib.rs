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
pub mod risk;
pub mod rng;
pub mod settlement;
pub mod state;
pub mod withdrawals;

use games::{
    baccarat::BaccaratBet,
    flip::CoinSide,
    hilo::HiloMove,
    roulette::{RouletteBet, RouletteChip},
    tower::TowerDifficulty,
    wheel::WheelRisk,
};
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

    pub fn open_account(ctx: Context<OpenAccount>, amount: u64) -> Result<()> {
        instructions::account::open_account(ctx, amount)
    }

    pub fn delegate_account(ctx: Context<DelegateAccount>) -> Result<()> {
        instructions::account::delegate_account(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::account::deposit(ctx, amount)
    }

    pub fn open_risk_pool(ctx: Context<OpenRiskPool>) -> Result<()> {
        instructions::pool::open_risk_pool(ctx)
    }

    pub fn delegate_risk_pool(ctx: Context<DelegateRiskPool>) -> Result<()> {
        instructions::pool::delegate_risk_pool(ctx)
    }

    pub fn fund_risk_pool(ctx: Context<FundRiskPool>, amount: u64) -> Result<()> {
        instructions::pool::fund_risk_pool(ctx, amount)
    }

    pub fn open_table(ctx: Context<OpenTable>) -> Result<()> {
        instructions::table::open_table(ctx)
    }

    pub fn delegate_table(ctx: Context<DelegateTable>) -> Result<()> {
        instructions::table::delegate_table(ctx)
    }

    pub fn open_mines_board(ctx: Context<OpenMinesBoard>) -> Result<()> {
        instructions::mines::open_mines_board(ctx)
    }

    pub fn delegate_mines_board(ctx: Context<DelegateMinesBoard>) -> Result<()> {
        instructions::mines::delegate_mines_board(ctx)
    }

    pub fn open_quick_table(ctx: Context<OpenQuickTable>) -> Result<()> {
        instructions::quick::open_quick_table(ctx)
    }

    pub fn delegate_quick_table(ctx: Context<DelegateQuickTable>) -> Result<()> {
        instructions::quick::delegate_quick_table(ctx)
    }

    pub fn open_hilo_board(ctx: Context<OpenHiloBoard>) -> Result<()> {
        instructions::hilo::open_hilo_board(ctx)
    }

    pub fn delegate_hilo_board(ctx: Context<DelegateHiloBoard>) -> Result<()> {
        instructions::hilo::delegate_hilo_board(ctx)
    }

    pub fn open_tower_board(ctx: Context<OpenTowerBoard>) -> Result<()> {
        instructions::tower::open_tower_board(ctx)
    }

    pub fn delegate_tower_board(ctx: Context<DelegateTowerBoard>) -> Result<()> {
        instructions::tower::delegate_tower_board(ctx)
    }

    pub fn open_roulette_table(ctx: Context<OpenRouletteTable>) -> Result<()> {
        instructions::roulette::open_roulette_table(ctx)
    }

    pub fn delegate_roulette_table(ctx: Context<DelegateRouletteTable>) -> Result<()> {
        instructions::roulette::delegate_roulette_table(ctx)
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

    pub fn mines_bet(ctx: Context<MinesPlay>, amount: u64, mines: u8) -> Result<()> {
        instructions::mines::mines_bet(ctx, amount, mines)
    }

    pub fn mines_reveal(ctx: Context<MinesPlay>, tile: u8, client_seed: [u8; 32]) -> Result<()> {
        instructions::mines::mines_reveal(ctx, tile, client_seed)
    }

    pub fn mines_cashout(ctx: Context<MinesPlay>) -> Result<()> {
        instructions::mines::mines_cashout(ctx)
    }

    pub fn expire_mines_round(ctx: Context<MinesPlay>, client_seed: [u8; 32]) -> Result<()> {
        instructions::mines::expire_mines_round(ctx, client_seed)
    }

    pub fn dice_roll(
        ctx: Context<QuickPlay>,
        amount: u64,
        target: u16,
        over: bool,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::quick::dice_roll(ctx, amount, target, over, client_seed)
    }

    pub fn limbo_play(
        ctx: Context<QuickPlay>,
        amount: u64,
        target: u32,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::quick::limbo_play(ctx, amount, target, client_seed)
    }

    pub fn flip_play(
        ctx: Context<QuickPlay>,
        amount: u64,
        side: CoinSide,
        flips: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::quick::flip_play(ctx, amount, side, flips, client_seed)
    }

    pub fn keno_play(
        ctx: Context<QuickPlay>,
        amount: u64,
        picks: Vec<u8>,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::quick::keno_play(ctx, amount, picks, client_seed)
    }

    pub fn wheel_spin(
        ctx: Context<QuickPlay>,
        amount: u64,
        segments: u8,
        risk: WheelRisk,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::quick::wheel_spin(ctx, amount, segments, risk, client_seed)
    }

    pub fn expire_quick_round(ctx: Context<QuickPlay>, client_seed: [u8; 32]) -> Result<()> {
        instructions::quick::expire_quick_round(ctx, client_seed)
    }

    pub fn hilo_bet(ctx: Context<HiloPlay>, amount: u64, client_seed: [u8; 32]) -> Result<()> {
        instructions::hilo::hilo_bet(ctx, amount, client_seed)
    }

    pub fn hilo_guess(
        ctx: Context<HiloPlay>,
        guess: HiloMove,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::hilo::hilo_guess(ctx, guess, client_seed)
    }

    pub fn hilo_cashout(ctx: Context<HiloPlay>) -> Result<()> {
        instructions::hilo::hilo_cashout(ctx)
    }

    pub fn expire_hilo_round(ctx: Context<HiloPlay>, client_seed: [u8; 32]) -> Result<()> {
        instructions::hilo::expire_hilo_round(ctx, client_seed)
    }

    pub fn tower_bet(
        ctx: Context<TowerPlay>,
        amount: u64,
        difficulty: TowerDifficulty,
    ) -> Result<()> {
        instructions::tower::tower_bet(ctx, amount, difficulty)
    }

    pub fn tower_climb(ctx: Context<TowerPlay>, tile: u8, client_seed: [u8; 32]) -> Result<()> {
        instructions::tower::tower_climb(ctx, tile, client_seed)
    }

    pub fn tower_cashout(ctx: Context<TowerPlay>) -> Result<()> {
        instructions::tower::tower_cashout(ctx)
    }

    pub fn expire_tower_round(ctx: Context<TowerPlay>, client_seed: [u8; 32]) -> Result<()> {
        instructions::tower::expire_tower_round(ctx, client_seed)
    }

    pub fn roulette_chips(
        ctx: Context<RoulettePlay>,
        chips: Vec<RouletteChip>,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::roulette::roulette_chips(ctx, chips, client_seed)
    }

    pub fn expire_roulette_round(ctx: Context<RoulettePlay>, client_seed: [u8; 32]) -> Result<()> {
        instructions::roulette::expire_roulette_round(ctx, client_seed)
    }

    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::play::consume_randomness(ctx, randomness, request_id)
    }

    pub fn consume_mines_randomness(
        ctx: Context<ConsumeMinesRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::mines::consume_mines_randomness(ctx, randomness, request_id)
    }

    pub fn consume_quick_randomness(
        ctx: Context<ConsumeQuickRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::quick::consume_quick_randomness(ctx, randomness, request_id)
    }

    pub fn consume_hilo_randomness(
        ctx: Context<ConsumeHiloRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::hilo::consume_hilo_randomness(ctx, randomness, request_id)
    }

    pub fn consume_tower_randomness(
        ctx: Context<ConsumeTowerRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::tower::consume_tower_randomness(ctx, randomness, request_id)
    }

    pub fn consume_roulette_randomness(
        ctx: Context<ConsumeRouletteRandomness>,
        randomness: [u8; 32],
        request_id: u64,
    ) -> Result<()> {
        instructions::roulette::consume_roulette_randomness(ctx, randomness, request_id)
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
