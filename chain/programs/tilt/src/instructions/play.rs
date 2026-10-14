//! Rounds, played in the rollup. Every random outcome comes from one MagicBlock VRF
//! draw, delivered to `consume_randomness`.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::{
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, TABLE_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::{
    baccarat::{BaccaratBet, BaccaratCoup},
    blackjack::{self, BlackjackTable, TableHand, MAX_HANDS},
    roulette::{RouletteBet, RouletteSpin},
    slots,
};
use crate::rng::Rng;
use crate::settlement::settle;
use crate::state::{Draw, Game, Ledger, PlayerAccount, RoundStatus, Vault};

#[vrf]
#[derive(Accounts)]
pub struct Play<'info> {
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
    /// The player's blackjack table: required by blackjack rounds, omitted (program id)
    /// by the other games.
    #[account(mut, seeds = [TABLE_SEED, account.player.as_ref()], bump)]
    pub table: Option<Account<'info, BlackjackTable>>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    /// Must be a player account PDA. The VRF program only calls back with the account the
    /// request named; this keeps the callback safe even if that ever changes.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    /// The player's table, for blackjack draws; the program id otherwise.
    #[account(mut, seeds = [TABLE_SEED, account.player.as_ref()], bump)]
    pub table: Option<Account<'info, BlackjackTable>>,
}

/// Emitted in the rollup when a round ends; with the account state, enough to display
/// and verify the round (replay `randomness` through the game rules).
#[event]
pub struct RoundSettled {
    pub player: Pubkey,
    pub round: u32,
    pub game: Game,
    pub stake: u64,
    pub payout: u64,
    pub fee: u64,
    pub request_id: u64,
    pub randomness: [u8; 32],
}

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Marks the round as waiting for `draw` under a new request id and asks the VRF oracle
/// for it. The id travels with the request, so only its own answer can play the draw.
/// The callback gets the player account and, for blackjack, the table.
fn request_draw(ctx: &mut Context<Play>, draw: Draw, client_seed: [u8; 32]) -> Result<()> {
    let table_meta = match &ctx.accounts.table {
        Some(table) => SerializableAccountMeta {
            pubkey: table.key(),
            is_signer: false,
            is_writable: true,
        },
        // Anchor reads the program id in an optional account's place as "none".
        None => SerializableAccountMeta {
            pubkey: crate::ID,
            is_signer: false,
            is_writable: false,
        },
    };
    let round = &mut ctx.accounts.account.round;
    require!(
        round.game != Game::Blackjack || ctx.accounts.table.is_some(),
        TiltError::MissingTable
    );
    round.request_id += 1;
    round.status = RoundStatus::AwaitingDraw(draw);
    round.last_action = now()?;
    let request_id = round.request_id;
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumeRandomness::DISCRIMINATOR.to_vec(),
        caller_seed: client_seed,
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.account.key(),
                is_signer: false,
                is_writable: true,
            },
            table_meta,
        ]),
        callback_args: Some(request_id.to_le_bytes().to_vec()),
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// Credits new deposits and takes the stake of a new round of `bets` bets of `bet`.
fn start(ctx: &mut Context<Play>, game: Game, bet: u64, bets: u8, max_gain: u64) -> Result<()> {
    let (ledger, config) = (&ctx.accounts.ledger, &ctx.accounts.vault.config);
    let account = &mut ctx.accounts.account;
    account.credit_deposits(ledger);
    account.start_round(game, bet, bets, max_gain, config, now()?)
}

fn table<'a>(ctx: &'a mut Context<Play>) -> Result<&'a mut BlackjackTable> {
    ctx.accounts
        .table
        .as_deref_mut()
        .ok_or_else(|| TiltError::MissingTable.into())
}

fn require_blackjack_turn(account: &PlayerAccount) -> Result<()> {
    require!(account.round.game == Game::Blackjack, TiltError::WrongState);
    require!(
        account.round.status == RoundStatus::PlayerTurn,
        TiltError::WrongState
    );
    Ok(())
}

/// Opens `hands` hands of `amount` each against one dealer.
pub fn blackjack_bet(
    mut ctx: Context<Play>,
    amount: u64,
    hands: u8,
    client_seed: [u8; 32],
) -> Result<()> {
    require!(
        (1..=MAX_HANDS as u8).contains(&hands),
        TiltError::InvalidBet
    );
    table(&mut ctx)?;
    let total = amount.saturating_mul(hands.into());
    start(
        &mut ctx,
        Game::Blackjack,
        amount,
        hands,
        blackjack::max_gain(total),
    )?;
    table(&mut ctx)?.start(amount, hands);
    request_draw(&mut ctx, Draw::Deal, client_seed)
}

/// One card to the active hand.
pub fn blackjack_hit(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    require_blackjack_turn(&ctx.accounts.account)?;
    require!(
        table(&mut ctx)?
            .active_hand()
            .is_some_and(TableHand::can_hit),
        TiltError::WrongState
    );
    request_draw(&mut ctx, Draw::Hit, client_seed)
}

/// Finishes the active hand. The next hand needs no draw; after the last one the dealer plays.
pub fn blackjack_stand(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    require_blackjack_turn(&ctx.accounts.account)?;
    if !table(&mut ctx)?.stand() {
        ctx.accounts.account.round.last_action = now()?;
        return Ok(());
    }
    request_draw(&mut ctx, Draw::Dealer, client_seed)
}

/// Doubles the active hand's bet; it takes one more card and is finished.
pub fn blackjack_double(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    require_blackjack_turn(&ctx.accounts.account)?;
    let table = table(&mut ctx)?;
    require!(
        table.active_hand().is_some_and(TableHand::can_double),
        TiltError::WrongState
    );
    let extra = table.bet;
    let account = &mut ctx.accounts.account;
    require!(account.balance >= extra, TiltError::InsufficientBalance);
    account.balance -= extra;
    account.round.stake += extra;
    request_draw(&mut ctx, Draw::Double, client_seed)
}

pub fn roulette_spin(
    mut ctx: Context<Play>,
    amount: u64,
    bet: RouletteBet,
    client_seed: [u8; 32],
) -> Result<()> {
    require!(bet.is_valid(), TiltError::InvalidBet);
    start(&mut ctx, Game::Roulette, amount, 1, bet.max_gain(amount))?;
    ctx.accounts.account.round.roulette = Some(RouletteSpin { bet, number: 0 });
    request_draw(&mut ctx, Draw::Spin, client_seed)
}

pub fn baccarat_deal(
    mut ctx: Context<Play>,
    amount: u64,
    bet: BaccaratBet,
    client_seed: [u8; 32],
) -> Result<()> {
    start(&mut ctx, Game::Baccarat, amount, 1, bet.max_gain(amount))?;
    ctx.accounts.account.round.baccarat = Some(BaccaratCoup::new(bet));
    request_draw(&mut ctx, Draw::Spin, client_seed)
}

pub fn slots_spin(mut ctx: Context<Play>, amount: u64, client_seed: [u8; 32]) -> Result<()> {
    start(&mut ctx, Game::Slots, amount, 1, slots::max_gain(amount))?;
    request_draw(&mut ctx, Draw::Spin, client_seed)
}

/// Relay cron. A draw that never arrived within `round_timeout_secs` is requested again
/// under a new id (the late answer to the old one, if it ever comes, is refused). A hand
/// waiting for the player is never closed for them: they come back to it whenever they want.
/// Blackjack retries must pass the table, like the original request.
pub fn expire_round(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    let timeout = ctx.accounts.vault.config.round_timeout_secs;
    require!(
        now()? - round.last_action >= timeout,
        TiltError::RoundNotExpired
    );
    let draw = draw_to_retry(round.status)?;
    request_draw(&mut ctx, draw, client_seed)
}

/// The draw `expire_round` requests again: only one that is still awaited.
fn draw_to_retry(status: RoundStatus) -> Result<Draw> {
    match status {
        RoundStatus::AwaitingDraw(draw) => Ok(draw),
        RoundStatus::PlayerTurn | RoundStatus::Idle => err!(TiltError::WrongState),
    }
}

/// VRF callback (only the VRF program can call it): plays the pending draw if this is the
/// answer to the pending request, and settles the round when it is over.
pub fn consume_randomness(
    ctx: Context<ConsumeRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let account = &mut ctx.accounts.account;
    let RoundStatus::AwaitingDraw(draw) = account.round.status else {
        return err!(TiltError::StaleRandomness);
    };
    require!(
        request_id == account.round.request_id,
        TiltError::StaleRandomness
    );
    let mut rng = Rng::from_vrf(randomness);
    let table = ctx.accounts.table.as_deref_mut();
    let Some(gross) = account.round.apply_draw(draw, &mut rng, table)? else {
        account.round.last_action = now()?;
        return Ok(());
    };
    let stake = account.round.stake;
    account.finish_round(settle(stake, gross));
    emit!(RoundSettled {
        player: account.player,
        round: account.rounds,
        game: account.round.game,
        stake,
        payout: account.round.payout,
        fee: account.round.fee,
        request_id,
        randomness,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_pending_draw_is_retried_never_a_hand_waiting_for_the_player() {
        for draw in [
            Draw::Deal,
            Draw::Hit,
            Draw::Double,
            Draw::Dealer,
            Draw::Spin,
        ] {
            assert_eq!(
                draw_to_retry(RoundStatus::AwaitingDraw(draw)).unwrap(),
                draw
            );
        }
        assert_eq!(
            draw_to_retry(RoundStatus::PlayerTurn).unwrap_err(),
            TiltError::WrongState.into()
        );
        assert_eq!(
            draw_to_retry(RoundStatus::Idle).unwrap_err(),
            TiltError::WrongState.into()
        );
    }
}
