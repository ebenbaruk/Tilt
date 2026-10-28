//! The house's risk pool (`risk::RiskPool`): opened once on Solana and moved into the rollup,
//! where every round prices itself against it. Its bankroll is a line reserved on Solana.

use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::constants::{RISK_POOL_SEED, VAULT_SEED, VAULT_TOKEN_SEED};
use crate::errors::TiltError;
use crate::risk::RiskPool;
use crate::state::Vault;

#[derive(Accounts)]
pub struct OpenRiskPool<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// The relay: pays the rent.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + RiskPool::INIT_SPACE, seeds = [RISK_POOL_SEED], bump)]
    pub risk_pool: Account<'info, RiskPool>,
    pub system_program: Program<'info, System>,
}

pub fn open_risk_pool(ctx: Context<OpenRiskPool>) -> Result<()> {
    ctx.accounts.risk_pool.bump = ctx.bumps.risk_pool;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRiskPool<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: the risk pool PDA handed to the rollup
    #[account(mut, del, seeds = [RISK_POOL_SEED], bump)]
    pub risk_pool: UncheckedAccount<'info>,
}

/// Moves the pool into the rollup for good, on the configured validator only.
pub fn delegate_risk_pool(ctx: Context<DelegateRiskPool>) -> Result<()> {
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_risk_pool(
        &ctx.accounts.payer,
        &[RISK_POOL_SEED],
        DelegateConfig {
            validator: Some(validator),
            // No commits: Solana keeps its own side of the pool (`Vault::pool_line`).
            ..Default::default()
        },
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct FundRiskPool<'info> {
    #[account(address = vault.relayer @ TiltError::Unauthorized)]
    pub relayer: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [VAULT_TOKEN_SEED], bump = vault.token_bump)]
    pub vault_token: Account<'info, TokenAccount>,
}

/// Solana, relayer: grants the risk pool `amount` more of the free bankroll, reserved like a
/// player's deposit. The rollup sees the larger line at the next round. Refused while bets are
/// paused: the line can never shrink, so an incident must not grow it.
pub fn fund_risk_pool(ctx: Context<FundRiskPool>, amount: u64) -> Result<()> {
    let a = ctx.accounts;
    let free = a.vault_token.amount.saturating_sub(a.vault.reserved);
    grant_line(&mut a.vault, free, amount)
}

fn grant_line(vault: &mut Vault, free: u64, amount: u64) -> Result<()> {
    require!(!vault.config.bets_paused, TiltError::Paused);
    require!(amount > 0, TiltError::AmountOutOfRange);
    require!(amount <= free, TiltError::VaultTooSmall);
    vault.reserved = vault
        .reserved
        .checked_add(amount)
        .ok_or(TiltError::AmountOutOfRange)?;
    vault.pool_line = vault
        .pool_line
        .checked_add(amount)
        .ok_or(TiltError::AmountOutOfRange)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instructions::testing::vault;

    #[test]
    fn the_line_comes_only_from_the_free_bankroll() {
        let mut v = vault();
        assert_eq!(
            grant_line(&mut v, 999, 1_000),
            Err(TiltError::VaultTooSmall.into())
        );
        grant_line(&mut v, 1_000, 1_000).unwrap();
        assert_eq!((v.reserved, v.pool_line), (1_000, 1_000));
        assert_eq!(
            grant_line(&mut v, 0, 0),
            Err(TiltError::AmountOutOfRange.into())
        );
    }

    #[test]
    fn no_line_is_granted_while_bets_are_paused() {
        let mut v = vault();
        v.config.bets_paused = true;
        assert_eq!(
            grant_line(&mut v, 1_000, 1_000),
            Err(TiltError::Paused.into())
        );
        assert_eq!((v.reserved, v.pool_line), (0, 0));
    }
}
