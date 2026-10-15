//! Withdrawals and loss checkpoints: requested in the rollup, applied on Solana after checks.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_rollups_sdk::{
    anchor::{action, commit},
    ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder},
    ActionArgs, ShortAccountMeta,
};

use crate::constants::{
    ACCOUNT_SEED, ACTION_ESCROW_INDEX, LEDGER_SEED, VAULT_SEED, VAULT_TOKEN_SEED,
};
use crate::errors::TiltError;
use crate::state::{Ledger, PlayerAccount, Vault};
use crate::withdrawals::{checked_forfeit, pay_due, read_claim, LossReleased, PayAccounts};

fn meta(key: Pubkey, is_writable: bool) -> ShortAccountMeta {
    ShortAccountMeta {
        pubkey: key.to_bytes().into(),
        is_writable,
    }
}

#[commit]
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Read-only copy of the Solana vault: relayer key and limits.
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(seeds = [LEDGER_SEED, account.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    /// CHECK: Solana accounts forwarded to the payment action, which validates them.
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: see `vault_token`
    pub player_token: UncheckedAccount<'info>,
    /// CHECK: see `vault_token`
    pub mint: UncheckedAccount<'info>,
    /// CHECK: see `vault_token`
    pub token_program: UncheckedAccount<'info>,
}

/// Rollup. Debits the balance, commits the account to Solana and schedules the payment
/// there. Allowed during a round: its stake is already out of the balance. The account
/// stays in the rollup.
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let min = ctx.accounts.vault.config.min_withdrawal;
    let account = &mut ctx.accounts.account;
    account.sync_ledger(&ctx.accounts.ledger);
    require!(
        amount > 0 && amount <= account.balance,
        TiltError::InsufficientBalance
    );
    require!(
        amount >= min || amount == account.balance,
        TiltError::WithdrawalTooSmall
    );
    account.balance -= amount;
    account.withdrawn += amount;
    // Anchor writes account changes back only when the instruction ends, but the commit
    // below snapshots the account now: flush the new totals first.
    ctx.accounts.account.exit(&crate::ID)?;

    let a = &ctx.accounts;
    let action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            meta(a.vault.key(), true),
            meta(a.account.key(), false),
            meta(a.vault_token.key(), true),
            meta(a.player_token.key(), true),
            meta(a.mint.key(), false),
            meta(a.ledger.key(), true),
            meta(a.token_program.key(), false),
        ],
        args: ActionArgs::new(anchor_lang::InstructionData::data(
            &crate::instruction::PayWithdrawals {},
        )),
        escrow_authority: a.payer.to_account_info(),
        compute_units: 200_000,
    };
    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit(&[a.account.to_account_info()])
    .add_post_commit_actions([action])
    .build_and_invoke()?;
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct PayWithdrawals<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    /// CHECK: last state committed by the rollup (owned by the delegation program); its
    /// claim is checked against the ledger by `checked_due`.
    #[account(seeds = [ACCOUNT_SEED, ledger.player.as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = ledger.player)]
    pub player_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [LEDGER_SEED, ledger.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    pub token_program: Program<'info, Token>,
    /// CHECK: the delegation program inserts the destination program id here
    #[account(address = crate::ID)]
    pub this_program: UncheckedAccount<'info>,
    /// CHECK: must be the relayer (checked in the handler)
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: Magic escrow PDA; only the delegation program can sign for it, which
    /// restricts this instruction to the post-commit action path.
    #[account(
        signer,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX),
    )]
    pub escrow: UncheckedAccount<'info>,
}

/// Solana, Magic Action only. Pays what is due within the automatic limits; holds the rest.
pub fn pay_withdrawals(ctx: Context<PayWithdrawals>) -> Result<()> {
    let a = ctx.accounts;
    require_keys_eq!(
        a.escrow_auth.key(),
        a.vault.relayer,
        TiltError::Unauthorized
    );
    pay_due(
        PayAccounts {
            vault: &mut a.vault,
            vault_token: &a.vault_token,
            player_token: &a.player_token,
            mint: &a.mint,
            ledger: &mut a.ledger,
            token_program: &a.token_program,
        },
        &a.account.to_account_info(),
        true,
    )
}

#[derive(Accounts)]
pub struct ReleaseWithdrawals<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = admin @ TiltError::Unauthorized, has_one = mint)]
    pub vault: Account<'info, Vault>,
    /// CHECK: last state committed by the rollup, checked by `checked_due`
    #[account(seeds = [ACCOUNT_SEED, ledger.player.as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = ledger.player)]
    pub player_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [LEDGER_SEED, ledger.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    pub token_program: Program<'info, Token>,
}

/// Solana, admin after review: pays held withdrawals. The anti-fraud check still applies.
pub fn release_withdrawals(ctx: Context<ReleaseWithdrawals>) -> Result<()> {
    let a = ctx.accounts;
    pay_due(
        PayAccounts {
            vault: &mut a.vault,
            vault_token: &a.vault_token,
            player_token: &a.player_token,
            mint: &a.mint,
            ledger: &mut a.ledger,
            token_program: &a.token_program,
        },
        &a.account.to_account_info(),
        false,
    )
}

#[commit]
#[derive(Accounts)]
pub struct Checkpoint<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(seeds = [LEDGER_SEED, account.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
}

/// Rollup, relay cron. Marks the player's losses so far as final, commits the account and
/// schedules `apply_checkpoint` on Solana, which releases them from the vault reservation
/// so house winnings can be withdrawn. The player's win headroom starts again from here.
pub fn checkpoint(ctx: Context<Checkpoint>) -> Result<()> {
    let account = &mut ctx.accounts.account;
    account.sync_ledger(&ctx.accounts.ledger);
    require!(
        account.round.status == crate::state::RoundStatus::Idle,
        TiltError::RoundInProgress
    );
    let loss = account.unforfeited_loss();
    // A checkpoint whose Solana side failed (e.g. relayer rotated meanwhile) can be pushed
    // again: the rollup still holds the forfeited total that Solana has not applied.
    let unapplied = account.forfeited > ctx.accounts.ledger.forfeited;
    require!(loss > 0 || unapplied, TiltError::NothingToCheckpoint);
    account.forfeited += loss;
    ctx.accounts.account.exit(&crate::ID)?;

    let a = &ctx.accounts;
    let action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            meta(a.vault.key(), true),
            meta(a.account.key(), false),
            meta(a.ledger.key(), true),
        ],
        args: ActionArgs::new(anchor_lang::InstructionData::data(
            &crate::instruction::ApplyCheckpoint {},
        )),
        escrow_authority: a.payer.to_account_info(),
        compute_units: 100_000,
    };
    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit(&[a.account.to_account_info()])
    .add_post_commit_actions([action])
    .build_and_invoke()?;
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct ApplyCheckpoint<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: last state committed by the rollup, checked by `checked_forfeit`
    #[account(seeds = [ACCOUNT_SEED, ledger.player.as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
    #[account(mut, seeds = [LEDGER_SEED, ledger.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    /// CHECK: the delegation program inserts the destination program id here
    #[account(address = crate::ID)]
    pub this_program: UncheckedAccount<'info>,
    /// CHECK: must be the relayer (checked in the handler)
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: Magic escrow PDA, see `PayWithdrawals`.
    #[account(
        signer,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX),
    )]
    pub escrow: UncheckedAccount<'info>,
}

/// Solana, Magic Action only. Releases newly forfeited losses from the vault reservation.
pub fn apply_checkpoint(ctx: Context<ApplyCheckpoint>) -> Result<()> {
    let a = ctx.accounts;
    require_keys_eq!(
        a.escrow_auth.key(),
        a.vault.relayer,
        TiltError::Unauthorized
    );
    let claim = read_claim(&a.account.to_account_info())?;
    let released = checked_forfeit(&claim, &a.ledger)?;
    if released == 0 {
        return Ok(());
    }
    a.ledger.forfeited = claim.forfeited;
    a.vault.reserved -= released;
    emit!(LossReleased {
        player: claim.player,
        amount: released,
        forfeited_total: claim.forfeited
    });
    Ok(())
}
