//! Hilo: the board is opened on Solana and delegated like the Mines board; rounds play in the
//! rollup. A bet draws the first card; each guess draws the next one, answered by
//! `consume_hilo_randomness`; a cash-out settles at once.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{ACCOUNT_SEED, HILO_SEED, LEDGER_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::hilo::{HiloBoard, HiloMove};
use crate::instructions::play::{
    callback_account, draw_request, expired_draw, now, pending_draw, settle_round,
};
use crate::rng::Rng;
use crate::state::{Config, Draw, Game, Ledger, PlayerAccount, Round, RoundStatus, Vault};

#[derive(Accounts)]
pub struct OpenHiloBoard<'info> {
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
    #[account(init, payer = payer, space = 8 + HiloBoard::INIT_SPACE, seeds = [HILO_SEED, player.key().as_ref()], bump)]
    pub board: Account<'info, HiloBoard>,
    pub system_program: Program<'info, System>,
}

pub fn open_hilo_board(ctx: Context<OpenHiloBoard>) -> Result<()> {
    let board = &mut ctx.accounts.board;
    **board = HiloBoard {
        player: ctx.accounts.player.key(),
        ..HiloBoard::default()
    };
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateHiloBoard<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the board PDA handed to the rollup
    #[account(mut, del, seeds = [HILO_SEED, player.key().as_ref()], bump)]
    pub board: UncheckedAccount<'info>,
}

/// Moves the board into the rollup for good, on the configured validator only.
pub fn delegate_hilo_board(ctx: Context<DelegateHiloBoard>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_board(
        &ctx.accounts.payer,
        &[HILO_SEED, player.as_ref()],
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
pub struct HiloPlay<'info> {
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
    #[account(mut, seeds = [HILO_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, HiloBoard>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeHiloRandomness<'info> {
    /// Must be a player account PDA, like in `consume_randomness`.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(mut, seeds = [HILO_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, HiloBoard>,
}

/// Takes the stake of a new round and resets the board; the first card is drawn next. The
/// multiplier has no ceiling of its own: the round limit is the cap.
fn start_hilo(
    account: &mut PlayerAccount,
    board: &mut HiloBoard,
    amount: u64,
    config: &Config,
    now: i64,
) -> Result<()> {
    let max_gain = config.max_round_gain;
    account.start_round(Game::Hilo, amount, 1, max_gain, config, now)?;
    board.start(amount, max_gain);
    Ok(())
}

fn require_hilo_turn(round: &Round) -> Result<()> {
    require!(
        round.game == Game::Hilo && round.status == RoundStatus::PlayerTurn,
        TiltError::WrongState
    );
    Ok(())
}

fn check_guess(round: &Round, board: &HiloBoard, guess: HiloMove) -> Result<()> {
    require_hilo_turn(round)?;
    require!(board.can_guess(guess), TiltError::InvalidChoice);
    Ok(())
}

fn check_cash_out(round: &Round, board: &HiloBoard) -> Result<()> {
    require_hilo_turn(round)?;
    require!(board.can_cash_out(), TiltError::WrongState);
    Ok(())
}

/// The answer to `request_id` plays a card only if the Hilo round awaits one.
fn check_hilo_draw(round: &Round, board: &HiloBoard, request_id: u64) -> Result<()> {
    let draw = pending_draw(round, request_id)?;
    require!(
        round.game == Game::Hilo && draw == Draw::Card && board.awaits_card(),
        TiltError::WrongState
    );
    Ok(())
}

/// Asks for the awaited card, answered by `consume_hilo_randomness` with the player account
/// and the board.
fn request_card(ctx: &mut Context<HiloPlay>, client_seed: [u8; 32]) -> Result<()> {
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        callback_account(ctx.accounts.board.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        Draw::Card,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeHiloRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

pub fn hilo_bet(mut ctx: Context<HiloPlay>, amount: u64, client_seed: [u8; 32]) -> Result<()> {
    let accounts = &mut ctx.accounts;
    accounts.account.sync_ledger(&accounts.ledger);
    start_hilo(
        &mut accounts.account,
        &mut accounts.board,
        amount,
        &accounts.vault.config,
        now()?,
    )?;
    request_card(&mut ctx, client_seed)
}

pub fn hilo_guess(
    mut ctx: Context<HiloPlay>,
    guess: HiloMove,
    client_seed: [u8; 32],
) -> Result<()> {
    check_guess(&ctx.accounts.account.round, &ctx.accounts.board, guess)?;
    ctx.accounts.board.pending = guess.code();
    request_card(&mut ctx, client_seed)
}

/// Settles at the current multiplier. No draw: the event carries the last request id and
/// zero randomness.
pub fn hilo_cashout(ctx: Context<HiloPlay>) -> Result<()> {
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

/// Relay cron: requests an awaited card again, like `expire_round`. A board waiting for the
/// player never expires.
pub fn expire_hilo_round(mut ctx: Context<HiloPlay>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(round.game == Game::Hilo, TiltError::WrongState);
    expired_draw(round, ctx.accounts.vault.config.round_timeout_secs)?;
    request_card(&mut ctx, client_seed)
}

/// VRF callback for cards: a wrong guess busts the round, the cap or a full board cashes out,
/// anything else goes back to the player.
pub fn consume_hilo_randomness(
    ctx: Context<ConsumeHiloRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let accounts = ctx.accounts;
    check_hilo_draw(&accounts.account.round, &accounts.board, request_id)?;
    let Some(gross) = accounts.board.draw(&mut Rng::from_vrf(randomness)) else {
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
    use crate::games::hilo::{randomness_for, FAIR_ONE};
    use crate::instructions::testing::{account, config};
    use crate::settlement::settle;

    /// Requests a card like the instructions do, then plays the first seed giving `rank`.
    fn card(a: &mut PlayerAccount, b: &mut HiloBoard, rank: u8) -> Option<u64> {
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Card);
        check_hilo_draw(&a.round, b, a.round.request_id).unwrap();
        let gross = b.draw(&mut Rng::from_vrf(randomness_for(rank)));
        match gross {
            Some(gross) => a.finish_round(settle(a.round.stake, gross)),
            None => a.round.status = RoundStatus::PlayerTurn,
        }
        gross
    }

    /// A round of 1 000 000 showing `first`, waiting for the player.
    fn started(first: u8) -> (PlayerAccount, HiloBoard) {
        let (mut a, mut b) = (account(), HiloBoard::default());
        start_hilo(&mut a, &mut b, 1_000_000, &config(), 0).unwrap();
        assert_eq!(card(&mut a, &mut b, first), None);
        (a, b)
    }

    fn guess(a: &mut PlayerAccount, b: &mut HiloBoard, guess: HiloMove, next: u8) -> Option<u64> {
        check_guess(&a.round, b, guess).unwrap();
        b.pending = guess.code();
        card(a, b, next)
    }

    #[test]
    fn a_bet_takes_the_stake_and_draws_the_first_card() {
        let (mut a, mut b) = (account(), HiloBoard::default());
        start_hilo(&mut a, &mut b, 1_000_000, &config(), 0).unwrap();
        assert_eq!((a.balance, a.round.game), (9_000_000, Game::Hilo));
        assert_eq!((b.max_gain, b.fair), (50_000_000, FAIR_ONE));
        assert_eq!(
            check_guess(&a.round, &b, HiloMove::Skip),
            Err(TiltError::WrongState.into()),
            "the first card is pending"
        );
        assert_eq!(card(&mut a, &mut b, 9), None);
        assert_eq!(a.round.status, RoundStatus::PlayerTurn);
        assert_eq!(b.current_rank(), Some(9));
    }

    #[test]
    fn a_cash_out_pays_the_multiplier_minus_the_fee() {
        let (mut a, mut b) = started(9);
        assert_eq!(
            check_cash_out(&a.round, &b),
            Err(TiltError::WrongState.into()),
            "no right guess yet"
        );
        // Lower from 9: 9 ranks win, 13/9 = 1.444444; × 0.98 = 1.415555.
        assert_eq!(guess(&mut a, &mut b, HiloMove::Lower, 9), None);
        check_cash_out(&a.round, &b).unwrap();
        assert_eq!(b.gross(), 1_415_555);
        a.finish_round(settle(a.round.stake, b.gross()));
        assert_eq!((a.round.payout, a.round.fee), (1_411_400, 4_155));
    }

    #[test]
    fn a_wrong_guess_loses_the_stake() {
        let (mut a, mut b) = started(9);
        assert_eq!(guess(&mut a, &mut b, HiloMove::Higher, 8), Some(0));
        assert_eq!((a.balance, a.round.status), (9_000_000, RoundStatus::Idle));
        assert!(b.busted);
        assert_eq!(
            check_guess(&a.round, &b, HiloMove::Higher),
            Err(TiltError::WrongState.into()),
            "round over"
        );
    }

    #[test]
    fn refused_guesses() {
        let (mut a, mut b) = started(1);
        assert_eq!(
            check_guess(&a.round, &b, HiloMove::Higher),
            Err(TiltError::InvalidChoice.into()),
            "higher than an ace is certain"
        );
        for _ in 0..10 {
            guess(&mut a, &mut b, HiloMove::Skip, 5);
        }
        assert_eq!(
            check_guess(&a.round, &b, HiloMove::Skip),
            Err(TiltError::InvalidChoice.into()),
            "ten skips used"
        );
        check_guess(&a.round, &b, HiloMove::Lower).unwrap();
    }

    #[test]
    fn the_cap_cashes_out_automatically() {
        let small = Config {
            max_round_gain: 2_000_000,
            ..config()
        };
        let (mut a, mut b) = (account(), HiloBoard::default());
        start_hilo(&mut a, &mut b, 1_000_000, &small, 0).unwrap();
        card(&mut a, &mut b, 2);
        // Lower from 2: 6.5x, past the 3x cap.
        assert_eq!(guess(&mut a, &mut b, HiloMove::Lower, 1), Some(3_000_000));
        assert_eq!(a.balance, 9_000_000 + settle(1_000_000, 3_000_000).payout);
    }

    #[test]
    fn the_round_limit_and_the_win_cap_apply() {
        let (mut a, mut b) = (account(), HiloBoard::default());
        a.max_win = 49_999_999;
        assert_eq!(
            start_hilo(&mut a, &mut b, 1_000_000, &config(), 0),
            Err(TiltError::WinCapReached.into())
        );
        assert_eq!(
            b,
            HiloBoard::default(),
            "a refused bet leaves the board alone"
        );
    }

    #[test]
    fn stale_or_foreign_randomness_is_refused() {
        let (mut a, mut b) = started(5);
        assert_eq!(
            check_hilo_draw(&a.round, &b, a.round.request_id),
            Err(TiltError::StaleRandomness.into()),
            "nothing pending"
        );
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Card);
        assert_eq!(
            check_hilo_draw(&a.round, &b, a.round.request_id),
            Err(TiltError::WrongState.into()),
            "no guess waits for a card"
        );
        b.pending = HiloMove::Higher.code();
        assert_eq!(
            check_hilo_draw(&a.round, &b, a.round.request_id - 1),
            Err(TiltError::StaleRandomness.into())
        );
        check_hilo_draw(&a.round, &b, a.round.request_id).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Climb);
        assert_eq!(
            check_hilo_draw(&a.round, &b, a.round.request_id),
            Err(TiltError::WrongState.into())
        );
        assert_eq!(b.pending, HiloMove::Higher.code());
    }
}
