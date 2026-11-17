//! The one-draw games (Dice, Limbo, Flip, Keno, Wheel): the player's `QuickTable` is opened
//! on Solana and delegated like the Mines board; rounds play in the rollup. A bet takes one
//! VRF draw, answered by `consume_quick_randomness`, which settles the round.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, QUICK_SEED, RISK_POOL_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::{
    flip::CoinSide,
    quick::{QuickRound, QuickTable},
    wheel::WheelRisk,
};
use crate::instructions::play::{
    callback_account, draw_request, expired_draw, now, pending_draw, settle_round,
};
use crate::risk::RiskPool;
use crate::rng::Rng;
use crate::state::{Bankroll, Draw, Ledger, PlayerAccount, Round, Vault};

#[derive(Accounts)]
pub struct OpenQuickTable<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// The relay: pays the rent.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// Only players with an account get a table.
    #[account(seeds = [LEDGER_SEED, player.key().as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    #[account(init, payer = payer, space = 8 + QuickTable::INIT_SPACE, seeds = [QUICK_SEED, player.key().as_ref()], bump)]
    pub quick: Account<'info, QuickTable>,
    pub system_program: Program<'info, System>,
}

pub fn open_quick_table(ctx: Context<OpenQuickTable>) -> Result<()> {
    let quick = &mut ctx.accounts.quick;
    **quick = QuickTable {
        player: ctx.accounts.player.key(),
        ..QuickTable::default()
    };
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateQuickTable<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the table PDA handed to the rollup
    #[account(mut, del, seeds = [QUICK_SEED, player.key().as_ref()], bump)]
    pub quick: UncheckedAccount<'info>,
}

/// Moves the table into the rollup for good, on the configured validator only.
pub fn delegate_quick_table(ctx: Context<DelegateQuickTable>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_quick(
        &ctx.accounts.payer,
        &[QUICK_SEED, player.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            // No commits: the table only matters in the rollup.
            ..Default::default()
        },
    )?;
    Ok(())
}

#[vrf]
#[derive(Accounts)]
pub struct QuickPlay<'info> {
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
    #[account(mut, seeds = [QUICK_SEED, account.player.as_ref()], bump)]
    pub quick: Account<'info, QuickTable>,
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeQuickRandomness<'info> {
    /// Must be a player account PDA, like in `consume_randomness`.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(mut, seeds = [QUICK_SEED, account.player.as_ref()], bump)]
    pub quick: Account<'info, QuickTable>,
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
}

/// Takes the stake of a new round on `round` after checking the choice. Its worst case is
/// never capped: one that could gain more than a round allows is refused by `start_round`.
fn start_quick(
    account: &mut PlayerAccount,
    quick: &mut QuickTable,
    amount: u64,
    round: QuickRound,
    bank: &mut Bankroll,
    now: i64,
) -> Result<()> {
    let game = round.game().ok_or(TiltError::InvalidChoice)?;
    let max_gain = round.max_gain(amount).ok_or(TiltError::InvalidChoice)?;
    account.start_round(game, amount, 1, max_gain, bank, now)?;
    quick.start(amount, round);
    Ok(())
}

/// The answer to `request_id` plays the round only if it is the pending one-draw round.
fn check_quick_draw(round: &Round, quick: &QuickTable, request_id: u64) -> Result<()> {
    let draw = pending_draw(round, request_id)?;
    require!(
        draw == Draw::Spin && quick.round.game() == Some(round.game) && !quick.drawn,
        TiltError::WrongState
    );
    Ok(())
}

/// Asks for the round's draw, answered by `consume_quick_randomness` with the player account,
/// the table and the risk pool.
fn request_quick_draw(ctx: &mut Context<QuickPlay>, client_seed: [u8; 32]) -> Result<()> {
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        callback_account(ctx.accounts.quick.key()),
        callback_account(ctx.accounts.risk_pool.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        Draw::Spin,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeQuickRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

fn play(
    mut ctx: Context<QuickPlay>,
    amount: u64,
    round: QuickRound,
    client_seed: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts;
    a.account.sync_ledger(&a.ledger);
    let mut bank = Bankroll {
        config: &a.vault.config,
        pool: &mut a.risk_pool,
        line: a.vault.pool_line,
    };
    start_quick(
        &mut a.account,
        &mut a.quick,
        amount,
        round,
        &mut bank,
        now()?,
    )?;
    request_quick_draw(&mut ctx, client_seed)
}

pub fn dice_roll(
    ctx: Context<QuickPlay>,
    amount: u64,
    target: u16,
    over: bool,
    client_seed: [u8; 32],
) -> Result<()> {
    let round = QuickRound::Dice {
        target,
        over,
        roll: 0,
    };
    play(ctx, amount, round, client_seed)
}

pub fn limbo_play(
    ctx: Context<QuickPlay>,
    amount: u64,
    target: u32,
    client_seed: [u8; 32],
) -> Result<()> {
    let round = QuickRound::Limbo { target, result: 0 };
    play(ctx, amount, round, client_seed)
}

pub fn flip_play(
    ctx: Context<QuickPlay>,
    amount: u64,
    side: CoinSide,
    flips: u8,
    client_seed: [u8; 32],
) -> Result<()> {
    let round = QuickRound::Flip {
        side,
        flips,
        coins: 0,
    };
    play(ctx, amount, round, client_seed)
}

pub fn keno_play(
    ctx: Context<QuickPlay>,
    amount: u64,
    picks: Vec<u8>,
    client_seed: [u8; 32],
) -> Result<()> {
    let round = QuickRound::keno(&picks).ok_or(TiltError::InvalidChoice)?;
    play(ctx, amount, round, client_seed)
}

pub fn wheel_spin(
    ctx: Context<QuickPlay>,
    amount: u64,
    segments: u8,
    risk: WheelRisk,
    client_seed: [u8; 32],
) -> Result<()> {
    let round = QuickRound::Wheel {
        segments,
        risk,
        segment: 0,
    };
    play(ctx, amount, round, client_seed)
}

/// Relay cron: requests an awaited draw again, like `expire_round`.
pub fn expire_quick_round(mut ctx: Context<QuickPlay>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(round.game.is_quick(), TiltError::WrongState);
    expired_draw(&ctx.accounts.account, &ctx.accounts.vault.config)?;
    request_quick_draw(&mut ctx, client_seed)
}

/// VRF callback for the one-draw games: draws the outcome and settles the round.
pub fn consume_quick_randomness(
    ctx: Context<ConsumeQuickRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let accounts = ctx.accounts;
    check_quick_draw(&accounts.account.round, &accounts.quick, request_id)?;
    let gross = accounts.quick.play(&mut Rng::from_vrf(randomness));
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
    use crate::games::{dice, keno, limbo};
    use crate::instructions::testing::{account, bank, config, pool_of};
    use crate::settlement::settle;
    use crate::state::{Game, RoundStatus};

    /// `start_quick` against a risk pool whose line is `line`.
    fn start(
        a: &mut PlayerAccount,
        q: &mut QuickTable,
        round: QuickRound,
        line: u64,
    ) -> Result<()> {
        let (c, mut pool) = (config(), RiskPool::default());
        let mut bank = Bankroll {
            line,
            ..bank(&c, &mut pool)
        };
        start_quick(a, q, 1_000_000, round, &mut bank, 0)
    }

    fn started(round: QuickRound) -> Result<(PlayerAccount, QuickTable)> {
        let (mut a, mut q) = (account(), QuickTable::default());
        start(&mut a, &mut q, round, u64::MAX)?;
        Ok((a, q))
    }

    /// Requests the draw like the instructions do, then plays `randomness`.
    fn draw(a: &mut PlayerAccount, q: &mut QuickTable, randomness: [u8; 32]) -> u64 {
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        check_quick_draw(&a.round, q, a.round.request_id).unwrap();
        let gross = q.play(&mut Rng::from_vrf(randomness));
        a.finish_round(settle(a.round.stake, gross), &mut pool_of(a));
        gross
    }

    fn dice(target: u16, over: bool) -> QuickRound {
        QuickRound::Dice {
            target,
            over,
            roll: 0,
        }
    }

    #[test]
    fn a_bet_takes_the_stake_and_one_draw_settles_it() {
        let (mut a, mut q) = started(dice(5_000, false)).unwrap();
        assert_eq!((a.balance, a.round.game), (9_000_000, Game::Dice));
        assert_eq!(q.bet, 1_000_000);
        let randomness = [9; 32];
        let gross = draw(&mut a, &mut q, randomness);
        let roll = dice::roll(&mut Rng::from_vrf(randomness));
        assert_eq!(gross, dice::gross(1_000_000, 5_000, false, roll));
        assert_eq!(a.round.status, RoundStatus::Idle);
        assert_eq!(a.balance, 9_000_000 + settle(1_000_000, gross).payout);
        assert!(q.drawn);
    }

    #[test]
    fn choices_outside_the_rules_are_refused_before_the_stake() {
        for round in [
            dice(50, false),
            QuickRound::Limbo {
                target: 100,
                result: 0,
            },
            QuickRound::Flip {
                side: CoinSide::Tails,
                flips: 0,
                coins: 0,
            },
            QuickRound::keno(&[41]).unwrap(),
            QuickRound::Wheel {
                segments: 25,
                risk: WheelRisk::High,
                segment: 0,
            },
            QuickRound::Empty,
        ] {
            let (mut a, mut q) = (account(), QuickTable::default());
            assert_eq!(
                start(&mut a, &mut q, round, u64::MAX),
                Err(TiltError::InvalidChoice.into()),
                "{round:?}"
            );
            assert_eq!((a.balance, q.round), (10_000_000, QuickRound::Empty));
        }
    }

    #[test]
    fn a_choice_that_could_gain_too_much_is_refused_not_capped() {
        // Round limit 50 000 000: 98x dice on 1 000 000 gains 97 000 000; 10 000x limbo and
        // 10/10 keno likewise.
        for round in [
            dice(100, false),
            QuickRound::Limbo {
                target: limbo::MAX_TARGET,
                result: 0,
            },
            QuickRound::keno(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).unwrap(),
        ] {
            assert_eq!(
                started(round).err(),
                Some(TiltError::RoundGainTooHigh.into()),
                "{round:?}"
            );
        }
        // 50x (1 000 000 → 49 000 000 gain) fits.
        started(QuickRound::Limbo {
            target: 5_000,
            result: 0,
        })
        .unwrap();
    }

    #[test]
    fn the_risk_pool_applies() {
        // A 1 000 000 flip on one coin may gain 960 000.
        let flip = QuickRound::Flip {
            side: CoinSide::Heads,
            flips: 1,
            coins: 0,
        };
        let (mut a, mut q) = (account(), QuickTable::default());
        assert_eq!(
            start(&mut a, &mut q, flip, 959_999),
            Err(TiltError::RiskPoolFull.into())
        );
        start(&mut a, &mut q, flip, 960_000).unwrap();
    }

    #[test]
    fn stale_foreign_or_replayed_randomness_is_refused() {
        let (mut a, mut q) = started(QuickRound::keno(&[3, 4]).unwrap()).unwrap();
        assert_eq!(
            check_quick_draw(&a.round, &q, a.round.request_id),
            Err(TiltError::StaleRandomness.into()),
            "nothing pending"
        );
        a.round.request_id = 5;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        assert_eq!(
            check_quick_draw(&a.round, &q, 4),
            Err(TiltError::StaleRandomness.into())
        );
        check_quick_draw(&a.round, &q, 5).unwrap();
        // A table holding another game's round.
        let mut other = a.round.clone();
        other.game = Game::Wheel;
        assert_eq!(
            check_quick_draw(&other, &q, 5),
            Err(TiltError::WrongState.into())
        );
        a.round.status = RoundStatus::AwaitingDraw(Draw::Card);
        assert_eq!(
            check_quick_draw(&a.round, &q, 5),
            Err(TiltError::WrongState.into())
        );
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        q.drawn = true;
        assert_eq!(
            check_quick_draw(&a.round, &q, 5),
            Err(TiltError::WrongState.into())
        );
    }

    #[test]
    fn a_round_in_progress_blocks_a_new_bet() {
        let (mut a, mut q) = started(QuickRound::keno(&[3, 4]).unwrap()).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        let before = q.clone();
        assert_eq!(
            start(&mut a, &mut q, dice(5_000, true), u64::MAX),
            Err(TiltError::RoundInProgress.into())
        );
        assert_eq!(q, before, "a refused bet leaves the table alone");
        let QuickRound::Keno { n_picks, .. } = q.round else {
            panic!("keno round");
        };
        assert_eq!(n_picks, 2);
        assert_eq!(keno::paytable(2).len(), 3);
    }
}
