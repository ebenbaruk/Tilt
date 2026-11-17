//! Rounds, played in the rollup. Every random outcome comes from one MagicBlock VRF
//! draw, delivered to `consume_randomness`.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::{
    compat::Instruction,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, RISK_POOL_SEED, TABLE_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::{
    baccarat::{BaccaratBet, BaccaratCoup},
    blackjack::{self, BlackjackTable, TableHand, MAX_HANDS},
    roulette::{RouletteBet, RouletteSpin},
    slots,
};
use crate::risk::RiskPool;
use crate::rng::Rng;
use crate::settlement::settle;
use crate::state::{
    Bankroll, Config, Draw, Game, Ledger, PlayerAccount, Round, RoundStatus, Vault,
};

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
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
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
    #[account(mut, seeds = [RISK_POOL_SEED], bump = risk_pool.bump)]
    pub risk_pool: Account<'info, RiskPool>,
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

pub(crate) fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// An account the VRF callback writes.
pub(crate) fn callback_account(pubkey: Pubkey) -> SerializableAccountMeta {
    SerializableAccountMeta {
        pubkey,
        is_signer: false,
        is_writable: true,
    }
}

/// Marks `round` as waiting for `draw` under a new request id and builds the VRF request
/// for it. The id travels with the request, so only its own answer can play the draw.
pub(crate) fn draw_request(
    round: &mut Round,
    draw: Draw,
    payer: Pubkey,
    oracle_queue: Pubkey,
    callback_discriminator: &[u8],
    accounts_metas: Vec<SerializableAccountMeta>,
    client_seed: [u8; 32],
) -> Result<Instruction> {
    round.request_id += 1;
    round.status = RoundStatus::AwaitingDraw(draw);
    round.last_action = now()?;
    Ok(create_request_scoped_randomness_ix(
        RequestRandomnessParams {
            payer,
            oracle_queue,
            callback_program_id: crate::ID,
            callback_discriminator: callback_discriminator.to_vec(),
            caller_seed: client_seed,
            accounts_metas: Some(accounts_metas),
            callback_args: Some(round.request_id.to_le_bytes().to_vec()),
        },
    ))
}

/// Asks for `draw` with `consume_randomness` as the callback, which gets the player account,
/// for blackjack the table, and the risk pool.
fn request_draw(ctx: &mut Context<Play>, draw: Draw, client_seed: [u8; 32]) -> Result<()> {
    let table_meta = match &ctx.accounts.table {
        Some(table) => callback_account(table.key()),
        // Anchor reads the program id in an optional account's place as "none".
        None => SerializableAccountMeta {
            pubkey: crate::ID,
            is_signer: false,
            is_writable: false,
        },
    };
    require!(
        ctx.accounts.account.round.game != Game::Blackjack || ctx.accounts.table.is_some(),
        TiltError::MissingTable
    );
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        table_meta,
        callback_account(ctx.accounts.risk_pool.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        draw,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// The risk pool and limits a round of this context answers to.
fn bankroll<'a>(accounts: &'a mut Play) -> (&'a mut PlayerAccount, &'a Ledger, Bankroll<'a>) {
    let bank = Bankroll {
        config: &accounts.vault.config,
        pool: &mut accounts.risk_pool,
        line: accounts.vault.pool_line,
    };
    (&mut accounts.account, &accounts.ledger, bank)
}

/// Credits new deposits and takes the stake of a new round of `bets` bets of `bet`.
fn start(ctx: &mut Context<Play>, game: Game, bet: u64, bets: u8, max_gain: u64) -> Result<()> {
    let (account, ledger, mut bank) = bankroll(ctx.accounts);
    account.sync_ledger(ledger);
    account.start_round(game, bet, bets, max_gain, &mut bank, now()?)
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
    let (account, _, mut bank) = bankroll(ctx.accounts);
    account.take_double(extra, &mut bank)?;
    request_draw(&mut ctx, Draw::Double, client_seed)
}

/// Splits the active hand's pair into two hands for one more base bet; each takes one card.
/// The round's worst case is checked again with the extra hand (see `take_split`), against
/// the risk pool as it stands now.
pub fn blackjack_split(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    require_blackjack_turn(&ctx.accounts.account)?;
    let table = table(&mut ctx)?;
    require!(table.can_split(), TiltError::WrongState);
    let (bet, hands) = (table.bet, table.n_hands + 1);
    let (account, ledger, mut bank) = bankroll(ctx.accounts);
    account.sync_ledger(ledger);
    account.take_split(bet, hands, &mut bank)?;
    request_draw(&mut ctx, Draw::Split, client_seed)
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
/// left waiting for the player for `abandoned_round_secs` is closed for them: every hand
/// still to play stands and the dealer plays. Blackjack retries must pass the table, like
/// the original request; the games playing on their own account (Mines, the one-draw games,
/// Hilo, Tower, roulette chips) expire through their own `expire_*_round`, which calls back
/// with that account.
pub fn expire_round(mut ctx: Context<Play>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(
        round.game.draws_in_round() && !round.on_roulette_table(),
        TiltError::WrongState
    );
    match expire(&ctx.accounts.account, &ctx.accounts.vault.config)? {
        Expiry::Retry(draw) => request_draw(&mut ctx, draw, client_seed),
        // Only blackjack hands wait for the player among these games.
        Expiry::Abandoned => {
            table(&mut ctx)?.stand_all();
            request_draw(&mut ctx, Draw::Dealer, client_seed)
        }
    }
}

/// What the relay cron may do with a round left untouched.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Expiry {
    /// A draw still awaited after `round_timeout_secs`: requested again.
    Retry(Draw),
    /// A round left waiting for the player for `abandoned_round_secs`: closed for them as
    /// they could have closed it (a stand, a cash-out), so it stops holding the account.
    Abandoned,
}

/// How a round untouched since `round.last_action` expires at `now`, or why it does not.
pub(crate) fn expiry(round: &Round, config: &Config, now: i64) -> Result<Expiry> {
    let (expiry, after) = match round.status {
        RoundStatus::AwaitingDraw(draw) => (Expiry::Retry(draw), config.round_timeout_secs),
        RoundStatus::PlayerTurn => (Expiry::Abandoned, config.abandoned_round_secs),
        RoundStatus::Idle => return err!(TiltError::WrongState),
    };
    require!(now - round.last_action >= after, TiltError::RoundNotExpired);
    Ok(expiry)
}

/// A draw requested again by the relay: the abandoned request's answer can no longer play the
/// round. Public so anyone can see how often, and for whom, draws are retried.
#[event]
pub struct DrawRetried {
    pub player: Pubkey,
    pub round: u32,
    pub game: Game,
    /// The request given up on; the new one is `abandoned_request_id + 1`.
    pub abandoned_request_id: u64,
}

/// How the account's round expires now (`expiry`). A retry is published as `DrawRetried`
/// before the new request replaces the abandoned one.
pub(crate) fn expire(account: &PlayerAccount, config: &Config) -> Result<Expiry> {
    let round = &account.round;
    let outcome = expiry(round, config, now()?)?;
    if let Expiry::Retry(_) = outcome {
        emit!(DrawRetried {
            player: account.player,
            round: account.rounds,
            game: round.game,
            abandoned_request_id: round.request_id,
        });
    }
    Ok(outcome)
}

/// The draw to request again for a game that never waits for the player (the one-draw
/// games, roulette chips).
pub(crate) fn expired_draw(account: &PlayerAccount, config: &Config) -> Result<Draw> {
    match expire(account, config)? {
        Expiry::Retry(draw) => Ok(draw),
        Expiry::Abandoned => err!(TiltError::WrongState),
    }
}

/// The draw a VRF answer to `request_id` plays: only the pending request's.
pub(crate) fn pending_draw(round: &Round, request_id: u64) -> Result<Draw> {
    let RoundStatus::AwaitingDraw(draw) = round.status else {
        return err!(TiltError::StaleRandomness);
    };
    require!(request_id == round.request_id, TiltError::StaleRandomness);
    Ok(draw)
}

/// Ends the round with `gross` returned before Tilt's fee and emits `RoundSettled`, with the
/// randomness of the draw that ended it (zeros when a move ended it without a draw).
pub(crate) fn settle_round(
    account: &mut PlayerAccount,
    pool: &mut RiskPool,
    gross: u64,
    request_id: u64,
    randomness: [u8; 32],
) {
    let stake = account.round.stake;
    account.finish_round(settle(stake, gross), pool);
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
}

/// VRF callback (only the VRF program can call it): plays the pending draw if this is the
/// answer to the pending request, and settles the round when it is over.
pub fn consume_randomness(
    ctx: Context<ConsumeRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let account = &mut ctx.accounts.account;
    let draw = pending_draw(&account.round, request_id)?;
    let mut rng = Rng::from_vrf(randomness);
    let table = ctx.accounts.table.as_deref_mut();
    let Some(gross) = account.round.apply_draw(draw, &mut rng, table)? else {
        account.round.last_action = now()?;
        return Ok(());
    };
    settle_round(
        account,
        &mut ctx.accounts.risk_pool,
        gross,
        request_id,
        randomness,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::instructions::testing::config;

    const LAST_ACTION: i64 = 1_000;

    fn untouched(status: RoundStatus) -> Round {
        Round {
            status,
            last_action: LAST_ACTION,
            ..Round::default()
        }
    }

    #[test]
    fn an_awaited_draw_is_retried_after_the_round_timeout() {
        for draw in [
            Draw::Deal,
            Draw::Hit,
            Draw::Double,
            Draw::Dealer,
            Draw::Spin,
            Draw::Split,
            Draw::Reveal,
            Draw::Card,
            Draw::Climb,
        ] {
            let round = untouched(RoundStatus::AwaitingDraw(draw));
            let timeout = config().round_timeout_secs;
            assert_eq!(
                expiry(&round, &config(), LAST_ACTION + timeout - 1).unwrap_err(),
                TiltError::RoundNotExpired.into()
            );
            assert_eq!(
                expiry(&round, &config(), LAST_ACTION + timeout).unwrap(),
                Expiry::Retry(draw)
            );
        }
    }

    #[test]
    fn a_round_waiting_for_the_player_is_closed_only_once_abandoned() {
        let round = untouched(RoundStatus::PlayerTurn);
        let abandoned = config().abandoned_round_secs;
        // The round timeout is for draws only: a player thinking is never rushed by it.
        assert_eq!(
            expiry(&round, &config(), LAST_ACTION + abandoned - 1).unwrap_err(),
            TiltError::RoundNotExpired.into()
        );
        assert_eq!(
            expiry(&round, &config(), LAST_ACTION + abandoned).unwrap(),
            Expiry::Abandoned
        );
    }

    #[test]
    fn a_settled_round_never_expires() {
        assert_eq!(
            expiry(&untouched(RoundStatus::Idle), &config(), i64::MAX).unwrap_err(),
            TiltError::WrongState.into()
        );
    }

    #[test]
    fn only_the_pending_request_is_answered() {
        let mut round = Round {
            request_id: 7,
            status: RoundStatus::AwaitingDraw(Draw::Reveal),
            ..Round::default()
        };
        assert_eq!(pending_draw(&round, 7).unwrap(), Draw::Reveal);
        assert_eq!(
            pending_draw(&round, 6).unwrap_err(),
            TiltError::StaleRandomness.into()
        );
        for status in [RoundStatus::PlayerTurn, RoundStatus::Idle] {
            round.status = status;
            assert_eq!(
                pending_draw(&round, 7).unwrap_err(),
                TiltError::StaleRandomness.into()
            );
        }
    }
}
