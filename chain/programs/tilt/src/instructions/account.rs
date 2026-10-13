//! Opening a player account and depositing, on Solana.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, VAULT_SEED, VAULT_TOKEN_SEED};
use crate::errors::TiltError;
use crate::state::{Ledger, PlayerAccount, Vault};

fn transfer_in<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    player: &Signer<'info>,
    mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: player.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
pub struct OpenAccount<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = mint, has_one = treasury)]
    pub vault: Account<'info, Vault>,
    /// The relay: pays rents and fees in SOL, repaid in USDC from the deposit.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    pub player: Signer<'info>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + PlayerAccount::INIT_SPACE, seeds = [ACCOUNT_SEED, player.key().as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(init, payer = payer, space = 8 + Ledger::INIT_SPACE, seeds = [LEDGER_SEED, player.key().as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// First deposit. Sent in the same transaction as `delegate_account`, which refuses
/// accounts without a deposit: no deposit, no account in the rollup.
pub fn open_account(ctx: Context<OpenAccount>, amount: u64, max_win: u64) -> Result<()> {
    let a = &ctx.accounts;
    let config = &a.vault.config;
    require!(!config.deposits_paused, TiltError::Paused);
    require!(amount > config.onboarding_fee, TiltError::DepositTooSmall);
    let credited = amount - config.onboarding_fee;
    // Bounded on-chain so cheap accounts cannot lock up the bankroll.
    require!(
        max_win <= config.max_player_win
            && max_win as u128 <= credited as u128 * config.max_win_multiple as u128,
        TiltError::MaxWinTooHigh
    );
    let free = a.vault_token.amount.saturating_sub(a.vault.reserved);
    require!(free >= max_win, TiltError::VaultTooSmall);
    transfer_in(
        &a.player_token,
        &a.vault_token,
        &a.player,
        &a.mint,
        &a.token_program,
        credited,
    )?;
    transfer_in(
        &a.player_token,
        &a.treasury,
        &a.player,
        &a.mint,
        &a.token_program,
        config.onboarding_fee,
    )?;

    let player = ctx.accounts.player.key();
    ctx.accounts.vault.reserved += max_win + credited;
    let ledger = &mut ctx.accounts.ledger;
    ledger.player = player;
    ledger.deposited = credited;
    ledger.max_win = max_win;
    let account = &mut ctx.accounts.account;
    account.player = player;
    account.max_win = max_win;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAccount<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [LEDGER_SEED, player.key().as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    /// CHECK: the player account PDA handed to the rollup
    #[account(mut, del, seeds = [ACCOUNT_SEED, player.key().as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
}

/// Moves the player account into the rollup for good, on the configured validator only.
pub fn delegate_account(ctx: Context<DelegateAccount>) -> Result<()> {
    require!(ctx.accounts.ledger.deposited > 0, TiltError::NoDeposit);
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_account(
        &ctx.accounts.payer,
        &[ACCOUNT_SEED, player.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            // No periodic commits: the account is only committed on withdrawal or checkpoint.
            ..Default::default()
        },
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player)]
    pub player_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [LEDGER_SEED, player.key().as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    pub token_program: Program<'info, Token>,
}

/// Works while the player account is in the rollup: the next round credits it.
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(
        !ctx.accounts.vault.config.deposits_paused,
        TiltError::Paused
    );
    require!(
        amount >= ctx.accounts.vault.config.min_deposit,
        TiltError::AmountOutOfRange
    );
    let a = &ctx.accounts;
    transfer_in(
        &a.player_token,
        &a.vault_token,
        &a.player,
        &a.mint,
        &a.token_program,
        amount,
    )?;
    ctx.accounts.vault.reserved += amount;
    ctx.accounts.ledger.deposited += amount;
    Ok(())
}
