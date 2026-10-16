//! Tower: the board is opened on Solana and delegated like the Mines board; rounds play in the
//! rollup. A bet needs no draw; each climb takes one VRF draw, answered by
//! `consume_tower_randomness`; a cash-out settles at once.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, TOWER_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::tower::{self, TowerBoard, TowerDifficulty, NONE};
use crate::instructions::play::{
    callback_account, draw_request, expired_draw, now, pending_draw, settle_round,
};
use crate::rng::Rng;
use crate::state::{Config, Draw, Game, Ledger, PlayerAccount, Round, RoundStatus, Vault};

#[derive(Accounts)]
pub struct OpenTowerBoard<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// The relay: pays the rent.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// Only players with an account get a board.
    #[account(seeds = [LEDGER_SEED, player.key().as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    #[account(init, payer = payer, space = 8 + TowerBoard::INIT_SPACE, seeds = [TOWER_SEED, player.key().as_ref()], bump)]
    pub board: Account<'info, TowerBoard>,
    pub system_program: Program<'info, System>,
}

pub fn open_tower_board(ctx: Context<OpenTowerBoard>) -> Result<()> {
    let board = &mut ctx.accounts.board;
    **board = TowerBoard {
        player: ctx.accounts.player.key(),
        ..TowerBoard::default()
    };
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateTowerBoard<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the board PDA handed to the rollup
    #[account(mut, del, seeds = [TOWER_SEED, player.key().as_ref()], bump)]
    pub board: UncheckedAccount<'info>,
}

/// Moves the board into the rollup for good, on the configured validator only.
pub fn delegate_tower_board(ctx: Context<DelegateTowerBoard>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_board(
        &ctx.accounts.payer,
        &[TOWER_SEED, player.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            // No commits: the board only matters in the rollup.
            ..Default::default()
        },
    )?;
    Ok(())
}

#[vrf]
#[derive(Accounts)]
pub struct TowerPlay<'info> {
    /// Read-only copy of the Solana vault: relayer key and limits.
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// The Tilt relay, acting on the player's intents.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    /// Read-only copy of the Solana ledger, to credit new deposits.
    #[account(seeds = [LEDGER_SEED, account.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    #[account(mut, seeds = [TOWER_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, TowerBoard>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeTowerRandomness<'info> {
    /// Must be a player account PDA, like in `consume_randomness`.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(mut, seeds = [TOWER_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, TowerBoard>,
}

/// Takes the stake of a new round at `difficulty` and resets the board. No draw: the round
/// waits for the player's first climb.
fn start_tower(
    account: &mut PlayerAccount,
    board: &mut TowerBoard,
    amount: u64,
    difficulty: TowerDifficulty,
    config: &Config,
    now: i64,
) -> Result<()> {
    let max_gain = tower::max_gain(amount, difficulty, config.max_round_gain);
    account.start_round(Game::Tower, amount, 1, max_gain, config, now)?;
    account.round.status = RoundStatus::PlayerTurn;
    board.start(amount, difficulty, max_gain);
    Ok(())
}

fn require_tower_turn(round: &Round) -> Result<()> {
    require!(
        round.game == Game::Tower && round.status == RoundStatus::PlayerTurn,
        TiltError::WrongState
    );
    Ok(())
}

fn check_climb(round: &Round, board: &TowerBoard, tile: u8) -> Result<()> {
    require_tower_turn(round)?;
    require!(board.can_climb(tile), TiltError::InvalidChoice);
    Ok(())
}

fn check_cash_out(round: &Round, board: &TowerBoard) -> Result<()> {
    require_tower_turn(round)?;
    require!(board.can_cash_out(), TiltError::WrongState);
    Ok(())
}

/// The answer to `request_id` plays a climb only if it is the pending Tower climb.
fn check_tower_draw(round: &Round, board: &TowerBoard, request_id: u64) -> Result<()> {
    let draw = pending_draw(round, request_id)?;
    require!(
        round.game == Game::Tower && draw == Draw::Climb && board.pending != NONE,
        TiltError::WrongState
    );
    Ok(())
}

/// Asks for the pending tile's draw, answered by `consume_tower_randomness` with the player
/// account and the board.
fn request_climb(ctx: &mut Context<TowerPlay>, client_seed: [u8; 32]) -> Result<()> {
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        callback_account(ctx.accounts.board.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        Draw::Climb,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeTowerRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

pub fn tower_bet(ctx: Context<TowerPlay>, amount: u64, difficulty: TowerDifficulty) -> Result<()> {
    let accounts = ctx.accounts;
    accounts.account.sync_ledger(&accounts.ledger);
    start_tower(
        &mut accounts.account,
        &mut accounts.board,
        amount,
        difficulty,
        &accounts.vault.config,
        now()?,
    )
}

pub fn tower_climb(mut ctx: Context<TowerPlay>, tile: u8, client_seed: [u8; 32]) -> Result<()> {
    check_climb(&ctx.accounts.account.round, &ctx.accounts.board, tile)?;
    ctx.accounts.board.pending = tile;
    request_climb(&mut ctx, client_seed)
}

/// Settles at the current multiplier. No draw: the event carries the last request id and
/// zero randomness.
pub fn tower_cashout(ctx: Context<TowerPlay>) -> Result<()> {
    let accounts = ctx.accounts;
    check_cash_out(&accounts.account.round, &accounts.board)?;
    let request_id = accounts.account.round.request_id;
    settle_round(
        &mut accounts.account,
        accounts.board.gross(),
        request_id,
        [0; 32],
    );
    Ok(())
}

/// Relay cron: requests an awaited climb again, like `expire_round`. A board waiting for the
/// player never expires.
pub fn expire_tower_round(mut ctx: Context<TowerPlay>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(round.game == Game::Tower, TiltError::WrongState);
    expired_draw(round, ctx.accounts.vault.config.round_timeout_secs)?;
    request_climb(&mut ctx, client_seed)
}

/// VRF callback for climbs: a bad tile busts the round, the top or the cap cashes out, any
/// other safe tile goes back to the player.
pub fn consume_tower_randomness(
    ctx: Context<ConsumeTowerRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let accounts = ctx.accounts;
    check_tower_draw(&accounts.account.round, &accounts.board, request_id)?;
    let Some(gross) = accounts.board.climb(&mut Rng::from_vrf(randomness)) else {
        let round = &mut accounts.account.round;
        round.status = RoundStatus::PlayerTurn;
        round.last_action = now()?;
        return Ok(());
    };
    settle_round(&mut accounts.account, gross, request_id, randomness);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::tower::{gross_uncapped, randomness_for, LEVELS};
    use crate::instructions::testing::{account, config};
    use crate::settlement::settle;

    /// A round of 1 000 000 at `difficulty`, waiting for the player.
    fn started(difficulty: TowerDifficulty) -> (PlayerAccount, TowerBoard) {
        let (mut a, mut b) = (account(), TowerBoard::default());
        start_tower(&mut a, &mut b, 1_000_000, difficulty, &config(), 0).unwrap();
        (a, b)
    }

    /// Requests `tile` like `tower_climb`, then plays the first seed giving `safe`.
    fn climb(a: &mut PlayerAccount, b: &mut TowerBoard, tile: u8, safe: bool) -> Option<u64> {
        check_climb(&a.round, b, tile).unwrap();
        b.pending = tile;
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Climb);
        check_tower_draw(&a.round, b, a.round.request_id).unwrap();
        let gross = b.climb(&mut Rng::from_vrf(randomness_for(b.difficulty, safe)));
        match gross {
            Some(gross) => a.finish_round(settle(a.round.stake, gross)),
            None => a.round.status = RoundStatus::PlayerTurn,
        }
        gross
    }

    #[test]
    fn a_bet_takes_the_stake_and_waits_for_the_player() {
        let (a, b) = started(TowerDifficulty::Easy);
        assert_eq!(a.balance, 9_000_000);
        assert_eq!(
            (a.round.game, a.round.status),
            (Game::Tower, RoundStatus::PlayerTurn)
        );
        assert_eq!(a.round.request_id, 0, "no draw at bet time");
        // Easy tops at 13.05x: a 12.05x gain, within the 50 000 000 limit.
        assert_eq!(
            b.max_gain as u128,
            gross_uncapped(1_000_000, TowerDifficulty::Easy, LEVELS) - 1_000_000
        );
        let (_, master) = started(TowerDifficulty::Master);
        assert_eq!(master.max_gain, 50_000_000, "the round limit caps master");
    }

    #[test]
    fn a_cash_out_pays_the_multiplier_minus_the_fee() {
        let (mut a, mut b) = started(TowerDifficulty::Hard);
        assert_eq!(
            check_cash_out(&a.round, &b),
            Err(TiltError::WrongState.into()),
            "no level climbed"
        );
        assert_eq!(climb(&mut a, &mut b, 1, true), None);
        check_cash_out(&a.round, &b).unwrap();
        assert_eq!(b.gross(), 1_960_000);
        a.finish_round(settle(a.round.stake, b.gross()));
        assert_eq!((a.round.payout, a.round.fee), (1_950_400, 9_600));
    }

    #[test]
    fn a_bad_tile_loses_the_stake() {
        let (mut a, mut b) = started(TowerDifficulty::Medium);
        assert_eq!(climb(&mut a, &mut b, 0, true), None);
        assert_eq!(climb(&mut a, &mut b, 2, false), Some(0));
        assert_eq!((a.balance, b.busted, b.level), (9_000_000, 2, 1));
        assert_eq!(
            check_climb(&a.round, &b, 0),
            Err(TiltError::WrongState.into()),
            "round over"
        );
    }

    #[test]
    fn the_top_and_the_cap_cash_out_automatically() {
        let (mut a, mut b) = started(TowerDifficulty::Easy);
        for level in 0..LEVELS - 1 {
            assert_eq!(climb(&mut a, &mut b, level % 4, true), None);
        }
        assert_eq!(
            climb(&mut a, &mut b, 0, true).map(u128::from),
            Some(gross_uncapped(1_000_000, TowerDifficulty::Easy, LEVELS))
        );
        assert_eq!(a.round.status, RoundStatus::Idle);

        let small = Config {
            max_round_gain: 2_000_000,
            ..config()
        };
        let (mut a, mut b) = (account(), TowerBoard::default());
        start_tower(&mut a, &mut b, 1_000_000, TowerDifficulty::Hard, &small, 0).unwrap();
        assert_eq!(climb(&mut a, &mut b, 0, true), None);
        assert_eq!(climb(&mut a, &mut b, 0, true), Some(3_000_000));
    }

    #[test]
    fn refused_climbs_and_bets() {
        let (mut a, mut b) = started(TowerDifficulty::Expert);
        assert_eq!(
            check_climb(&a.round, &b, 3),
            Err(TiltError::InvalidChoice.into()),
            "expert has 3 tiles"
        );
        b.pending = 1;
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Climb);
        assert_eq!(
            check_climb(&a.round, &b, 0),
            Err(TiltError::WrongState.into())
        );
        assert_eq!(
            check_cash_out(&a.round, &b),
            Err(TiltError::WrongState.into())
        );
        assert_eq!(
            start_tower(
                &mut a,
                &mut b,
                1_000_000,
                TowerDifficulty::Easy,
                &config(),
                0
            ),
            Err(TiltError::RoundInProgress.into())
        );
        assert_eq!(b.pending, 1, "a refused bet leaves the board alone");
    }

    #[test]
    fn stale_or_foreign_randomness_is_refused() {
        let (mut a, mut b) = started(TowerDifficulty::Easy);
        assert_eq!(
            check_tower_draw(&a.round, &b, a.round.request_id),
            Err(TiltError::StaleRandomness.into()),
            "nothing pending"
        );
        b.pending = 2;
        a.round.request_id = 5;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Climb);
        assert_eq!(
            check_tower_draw(&a.round, &b, 4),
            Err(TiltError::StaleRandomness.into())
        );
        check_tower_draw(&a.round, &b, 5).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Reveal);
        assert_eq!(
            check_tower_draw(&a.round, &b, 5),
            Err(TiltError::WrongState.into())
        );
    }
}
