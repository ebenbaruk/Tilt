//! Mines: the board is opened on Solana and delegated like the blackjack table; rounds play in
//! the rollup. A bet needs no draw; each reveal takes one VRF draw, answered by
//! `consume_mines_randomness`; a cash-out settles at once.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, MINES_SEED, RISK_POOL_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::mines::{self, MinesBoard, MAX_MINES, NONE};
use crate::instructions::play::{
    callback_account, draw_request, expiry, now, pending_draw, settle_round, Expiry,
};
use crate::risk::RiskPool;
use crate::rng::Rng;
use crate::state::{Bankroll, Draw, Game, Ledger, PlayerAccount, Round, RoundStatus, Vault};

#[derive(Accounts)]
pub struct OpenMinesBoard<'info> {
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
    #[account(init, payer = payer, space = 8 + MinesBoard::INIT_SPACE, seeds = [MINES_SEED, player.key().as_ref()], bump)]
    pub board: Account<'info, MinesBoard>,
    pub system_program: Program<'info, System>,
}

pub fn open_mines_board(ctx: Context<OpenMinesBoard>) -> Result<()> {
    let board = &mut ctx.accounts.board;
    **board = MinesBoard {
        player: ctx.accounts.player.key(),
        ..MinesBoard::default()
    };
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateMinesBoard<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the board PDA handed to the rollup
    #[account(mut, del, seeds = [MINES_SEED, player.key().as_ref()], bump)]
    pub board: UncheckedAccount<'info>,
}

/// Moves the board into the rollup for good, on the configured validator only.
pub fn delegate_mines_board(ctx: Context<DelegateMinesBoard>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_board(
        &ctx.accounts.payer,
        &[MINES_SEED, player.as_ref()],
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
pub struct MinesPlay<'info> {
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
    #[account(mut, seeds = [MINES_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, MinesBoard>,
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeMinesRandomness<'info> {
    /// Must be a player account PDA, like in `consume_randomness`.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(mut, seeds = [MINES_SEED, account.player.as_ref()], bump)]
    pub board: Account<'info, MinesBoard>,
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
}

/// Takes the stake of a new round with `mines` mines and resets the board. No draw: the
/// round waits for the player's first reveal.
fn start_mines(
    account: &mut PlayerAccount,
    board: &mut MinesBoard,
    amount: u64,
    mines: u8,
    bank: &mut Bankroll,
    now: i64,
) -> Result<()> {
    require!((1..=MAX_MINES).contains(&mines), TiltError::InvalidBet);
    let max_gain = mines::max_gain(amount, mines, bank.config.max_round_gain);
    account.start_round(Game::Mines, amount, 1, max_gain, bank, now)?;
    account.round.status = RoundStatus::PlayerTurn;
    board.start(amount, mines, max_gain);
    Ok(())
}

fn require_mines_turn(round: &Round) -> Result<()> {
    require!(
        round.game == Game::Mines && round.status == RoundStatus::PlayerTurn,
        TiltError::WrongState
    );
    Ok(())
}

fn check_reveal(round: &Round, board: &MinesBoard, tile: u8) -> Result<()> {
    require_mines_turn(round)?;
    require!(board.can_reveal(tile), TiltError::InvalidTile);
    Ok(())
}

fn check_cash_out(round: &Round, board: &MinesBoard) -> Result<()> {
    require_mines_turn(round)?;
    require!(board.can_cash_out(), TiltError::WrongState);
    Ok(())
}

/// The answer to `request_id` plays a reveal only if it is the pending Mines reveal.
fn check_mines_draw(round: &Round, board: &MinesBoard, request_id: u64) -> Result<()> {
    let draw = pending_draw(round, request_id)?;
    require!(
        round.game == Game::Mines && draw == Draw::Reveal && board.pending != NONE,
        TiltError::WrongState
    );
    Ok(())
}

/// Asks for the pending tile's draw, answered by `consume_mines_randomness` with the player
/// account, the board and the risk pool.
fn request_reveal(ctx: &mut Context<MinesPlay>, client_seed: [u8; 32]) -> Result<()> {
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        callback_account(ctx.accounts.board.key()),
        callback_account(ctx.accounts.risk_pool.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        Draw::Reveal,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeMinesRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

pub fn mines_bet(ctx: Context<MinesPlay>, amount: u64, mines: u8) -> Result<()> {
    let a = ctx.accounts;
    a.account.sync_ledger(&a.ledger);
    let mut bank = Bankroll {
        config: &a.vault.config,
        pool: &mut a.risk_pool,
        line: a.vault.pool_line,
    };
    start_mines(
        &mut a.account,
        &mut a.board,
        amount,
        mines,
        &mut bank,
        now()?,
    )
}

pub fn mines_reveal(mut ctx: Context<MinesPlay>, tile: u8, client_seed: [u8; 32]) -> Result<()> {
    check_reveal(&ctx.accounts.account.round, &ctx.accounts.board, tile)?;
    ctx.accounts.board.pending = tile;
    request_reveal(&mut ctx, client_seed)
}

/// Settles at the current multiplier. No draw: the event carries the last request id and
/// zero randomness.
pub fn mines_cashout(ctx: Context<MinesPlay>) -> Result<()> {
    let accounts = ctx.accounts;
    check_cash_out(&accounts.account.round, &accounts.board)?;
    cash_out(accounts);
    Ok(())
}

fn cash_out(accounts: &mut MinesPlay) {
    let request_id = accounts.account.round.request_id;
    settle_round(
        &mut accounts.account,
        &mut accounts.risk_pool,
        accounts.board.gross(),
        request_id,
        [0; 32],
    );
}

/// Relay cron: requests an awaited reveal again, like `expire_round`. A board left waiting
/// for the player for `abandoned_round_secs` is cashed out for them at its current value,
/// 0.99x the stake before any safe tile.
pub fn expire_mines_round(mut ctx: Context<MinesPlay>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(round.game == Game::Mines, TiltError::WrongState);
    match expiry(round, &ctx.accounts.vault.config, now()?)? {
        Expiry::Retry(_) => request_reveal(&mut ctx, client_seed),
        Expiry::Abandoned => {
            cash_out(ctx.accounts);
            Ok(())
        }
    }
}

/// VRF callback for reveals: a mine busts the round, the last safe tile or the cap cashes
/// out, any other safe tile goes back to the player.
pub fn consume_mines_randomness(
    ctx: Context<ConsumeMinesRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let accounts = ctx.accounts;
    check_mines_draw(&accounts.account.round, &accounts.board, request_id)?;
    let mut rng = Rng::from_vrf(randomness);
    let Some(gross) = accounts.board.reveal(&mut rng) else {
        let round = &mut accounts.account.round;
        round.status = RoundStatus::PlayerTurn;
        round.last_action = now()?;
        return Ok(());
    };
    settle_round(
        &mut accounts.account,
        &mut accounts.risk_pool,
        gross,
        request_id,
        randomness,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::mines::{gross_uncapped, TILES};
    use crate::instructions::testing::{account, bank, config, pool_of};
    use crate::settlement::settle;
    use crate::state::Config;

    /// A round of 1 000 000 on `mines` mines, waiting for the player.
    fn started(mines: u8) -> (PlayerAccount, MinesBoard) {
        let (mut a, mut b) = (account(), MinesBoard::default());
        start(&mut a, &mut b, 1_000_000, mines, &config()).unwrap();
        (a, b)
    }

    /// `start_mines` against a risk pool that covers anything.
    fn start(
        a: &mut PlayerAccount,
        b: &mut MinesBoard,
        amount: u64,
        mines: u8,
        config: &Config,
    ) -> Result<()> {
        start_mines(
            a,
            b,
            amount,
            mines,
            &mut bank(config, &mut RiskPool::default()),
            0,
        )
    }

    #[test]
    fn an_abandoned_board_returns_its_cash_out_value_0_99x_before_any_safe_tile() {
        let (mut a, mut b) = started(3);
        // Before any safe tile the player cannot cash out; closing it for them returns 0.99x.
        assert!(check_cash_out(&a.round, &b).is_err());
        assert_eq!(b.gross(), 990_000);
        assert_eq!(reveal(&mut a, &mut b, 0, false), None);
        assert_eq!(b.gross(), gross_uncapped(1_000_000, 3, 1) as u64);
    }

    /// Requests `tile` like `mines_reveal`, then plays the first seed giving `mine`.
    fn reveal(a: &mut PlayerAccount, b: &mut MinesBoard, tile: u8, mine: bool) -> Option<u64> {
        check_reveal(&a.round, b, tile).unwrap();
        b.pending = tile;
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Reveal);
        check_mines_draw(&a.round, b, a.round.request_id).unwrap();
        let seed = mines::randomness_for(b.mines, b.n_revealed, mine);
        let gross = b.reveal(&mut Rng::from_vrf(seed));
        match gross {
            Some(gross) => a.finish_round(settle(a.round.stake, gross), &mut pool_of(a)),
            None => a.round.status = RoundStatus::PlayerTurn,
        }
        gross
    }

    #[test]
    fn a_bet_takes_the_stake_and_waits_for_the_player() {
        let (a, b) = started(3);
        assert_eq!(a.balance, 9_000_000);
        assert_eq!(
            (a.round.game, a.round.status),
            (Game::Mines, RoundStatus::PlayerTurn)
        );
        assert_eq!(a.round.request_id, 0, "no draw at bet time");
        assert_eq!((b.bet, b.mines, b.n_revealed), (1_000_000, 3, 0));
        // 3 mines can reach 2 277x: the round limit is the cap.
        assert_eq!(b.max_gain, 50_000_000);
    }

    #[test]
    fn mines_outside_1_to_24_are_refused() {
        for mines in [0, TILES, NONE] {
            let (mut a, mut b) = (account(), MinesBoard::default());
            assert_eq!(
                start(&mut a, &mut b, 1_000_000, mines, &config()),
                Err(TiltError::InvalidBet.into())
            );
            assert_eq!(a.balance, 10_000_000);
        }
    }

    #[test]
    fn the_round_limit_and_the_risk_pool_apply() {
        // 1 000 000 on 3 mines may gain the whole 50 000 000 round limit.
        let (c, mut pool) = (config(), RiskPool::default());
        let mut tight = Bankroll {
            config: &c,
            pool: &mut pool,
            line: 49_999_999,
        };
        let (mut a, mut b) = (account(), MinesBoard::default());
        assert_eq!(
            start_mines(&mut a, &mut b, 1_000_000, 3, &mut tight, 0),
            Err(TiltError::RiskPoolFull.into())
        );
        // 24 mines gain at most 23.75x: within a 23 750 000 line.
        let mut enough = Bankroll {
            line: 23_750_000,
            ..tight
        };
        start_mines(&mut a, &mut b, 1_000_000, 24, &mut enough, 0).unwrap();
    }

    #[test]
    fn a_small_bet_puts_a_gain_in_proportion_to_its_stake_on_the_pool() {
        // Far below the 50 000 000 round limit: 1 000 on 12 mines may only gain 9 999 000.
        let (mut a, mut b) = (account(), MinesBoard::default());
        let mut pool = RiskPool::default();
        start_mines(
            &mut a,
            &mut b,
            1_000,
            12,
            &mut bank(&config(), &mut pool),
            0,
        )
        .unwrap();
        assert_eq!(b.max_gain, 9_999_000);
        assert_eq!(pool.gains, 9_999_000);
    }

    #[test]
    fn a_cash_out_pays_the_multiplier_minus_the_fee() {
        let (mut a, mut b) = started(1);
        assert_eq!(
            check_cash_out(&a.round, &b),
            Err(TiltError::WrongState.into()),
            "nothing revealed"
        );
        assert_eq!(reveal(&mut a, &mut b, 0, false), None);
        check_cash_out(&a.round, &b).unwrap();
        // 1.03125x: gross 1 031 250, fee 1% of the 31 250 gain.
        assert_eq!(b.gross(), 1_031_250);
        a.finish_round(settle(a.round.stake, b.gross()), &mut pool_of(&a));
        assert_eq!((a.round.payout, a.round.fee), (1_030_938, 312));
        assert_eq!(a.round.status, RoundStatus::Idle);
    }

    #[test]
    fn a_mine_loses_the_stake() {
        let (mut a, mut b) = started(3);
        assert_eq!(reveal(&mut a, &mut b, 0, false), None);
        assert_eq!(reveal(&mut a, &mut b, 1, true), Some(0));
        assert_eq!((a.balance, a.round.payout, b.busted), (9_000_000, 0, 1));
        assert_eq!(a.round.status, RoundStatus::Idle);
        assert_eq!(
            check_reveal(&a.round, &b, 2),
            Err(TiltError::WrongState.into()),
            "round over"
        );
    }

    #[test]
    fn clearing_the_board_cashes_out_automatically() {
        // 1 000 on 23 mines: 297x for both safe tiles, below the cap.
        let (mut a, mut b) = (account(), MinesBoard::default());
        start(&mut a, &mut b, 1_000, 23, &config()).unwrap();
        assert_eq!(reveal(&mut a, &mut b, 3, false), None);
        let gross = reveal(&mut a, &mut b, 4, false).unwrap();
        assert_eq!(gross_uncapped(1_000, 23, 2), 297_000);
        assert_eq!(gross as u128, gross_uncapped(1_000, 23, 2));
        assert_eq!(a.round.status, RoundStatus::Idle);
    }

    #[test]
    fn the_cap_cashes_out_automatically() {
        let small = Config {
            max_round_gain: 2_000_000,
            ..config()
        };
        let (mut a, mut b) = (account(), MinesBoard::default());
        start(&mut a, &mut b, 1_000_000, 12, &small).unwrap();
        let mut tile = 0;
        let gross = loop {
            if let Some(gross) = reveal(&mut a, &mut b, tile, false) {
                break gross;
            }
            tile += 1;
        };
        assert_eq!(gross, 3_000_000, "stake + max_gain");
        assert_eq!(a.balance, 9_000_000 + settle(1_000_000, 3_000_000).payout);
    }

    #[test]
    fn refused_reveals() {
        let (mut a, mut b) = started(3);
        assert_eq!(
            check_reveal(&a.round, &b, TILES),
            Err(TiltError::InvalidTile.into())
        );
        reveal(&mut a, &mut b, 6, false);
        assert_eq!(
            check_reveal(&a.round, &b, 6),
            Err(TiltError::InvalidTile.into()),
            "already revealed"
        );
    }

    #[test]
    fn a_pending_reveal_blocks_every_other_move() {
        let (mut a, mut b) = started(3);
        reveal(&mut a, &mut b, 6, false);
        b.pending = 7;
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Reveal);
        assert_eq!(
            check_reveal(&a.round, &b, 8),
            Err(TiltError::WrongState.into())
        );
        assert_eq!(
            check_cash_out(&a.round, &b),
            Err(TiltError::WrongState.into())
        );
        assert_eq!(
            start(&mut a, &mut b, 1_000_000, 3, &config()),
            Err(TiltError::RoundInProgress.into())
        );
        assert_eq!(b.pending, 7, "a refused bet leaves the board alone");
    }

    #[test]
    fn stale_or_foreign_randomness_is_refused() {
        let (mut a, mut b) = started(3);
        assert_eq!(
            check_mines_draw(&a.round, &b, a.round.request_id),
            Err(TiltError::StaleRandomness.into()),
            "nothing pending"
        );
        b.pending = 2;
        a.round.request_id = 5;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Reveal);
        assert_eq!(
            check_mines_draw(&a.round, &b, 4),
            Err(TiltError::StaleRandomness.into())
        );
        check_mines_draw(&a.round, &b, 5).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        assert_eq!(
            check_mines_draw(&a.round, &b, 5),
            Err(TiltError::WrongState.into())
        );
    }

    #[test]
    fn blackjack_moves_do_not_apply_to_a_mines_round() {
        let (a, _) = started(3);
        let mut blackjack = a.round.clone();
        blackjack.game = Game::Blackjack;
        assert!(require_mines_turn(&a.round).is_ok());
        assert_eq!(
            require_mines_turn(&blackjack),
            Err(TiltError::WrongState.into())
        );
    }
}
