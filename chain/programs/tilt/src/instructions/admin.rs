//! House setup and treasury operations, on Solana.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{VAULT_SEED, VAULT_TOKEN_SEED};
use crate::errors::TiltError;
use crate::program::Tilt;
use crate::state::{Config, Vault};

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Must be the program's upgrade authority, so nobody can front-run the setup.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ TiltError::Unauthorized)]
    pub program: Program<'info, Tilt>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ TiltError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = admin, space = 8 + Vault::INIT_SPACE, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_TOKEN_SEED],
        bump,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(token::mint = mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey, config: Config) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.relayer = relayer;
    vault.mint = ctx.accounts.mint.key();
    vault.treasury = ctx.accounts.treasury.key();
    vault.bump = ctx.bumps.vault;
    vault.token_bump = ctx.bumps.vault_token;
    config.validate()?;
    vault.config = config;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminVault<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = admin @ TiltError::Unauthorized)]
    pub vault: Account<'info, Vault>,
}

pub fn set_config(ctx: Context<AdminVault>, config: Config) -> Result<()> {
    config.validate()?;
    ctx.accounts.vault.config = config;
    Ok(())
}

/// Hands the admin role to another key (e.g. a multisig) and/or rotates the relayer key.
/// Rotate the relayer only once its in-flight withdrawals and checkpoints have landed.
pub fn set_roles(ctx: Context<AdminVault>, admin: Pubkey, relayer: Pubkey) -> Result<()> {
    require!(
        admin != Pubkey::default() && relayer != Pubkey::default(),
        TiltError::InvalidConfig
    );
    let vault = &mut ctx.accounts.vault;
    vault.admin = admin;
    vault.relayer = relayer;
    Ok(())
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub source: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Adds house bankroll.
pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    token::transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.source.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault_token.to_account_info(),
                authority: a.funder.to_account_info(),
            },
        ),
        amount,
        a.mint.decimals,
    )
}

#[derive(Accounts)]
pub struct WithdrawHouse<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED],
        bump = vault.bump,
        has_one = admin @ TiltError::Unauthorized,
        has_one = mint,
        has_one = treasury,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Moves house profit to the treasury. Only funds not reserved for players can leave.
pub fn withdraw_house(ctx: Context<WithdrawHouse>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let free = a.vault_token.amount.saturating_sub(a.vault.reserved);
    require!(amount <= free, TiltError::VaultTooSmall);
    let seeds: &[&[u8]] = &[VAULT_SEED, &[a.vault.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault_token.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.treasury.to_account_info(),
                authority: a.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.mint.decimals,
    )
}
