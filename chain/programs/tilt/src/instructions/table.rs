//! Opening a player's blackjack table, on Solana. The relay sends `open_table` and
//! `delegate_table` in one transaction, like the player account.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::constants::{LEDGER_SEED, TABLE_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::blackjack::BlackjackTable;
use crate::state::{Ledger, Vault};

#[derive(Accounts)]
pub struct OpenTable<'info> {
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
    #[account(init, payer = payer, space = 8 + BlackjackTable::INIT_SPACE, seeds = [TABLE_SEED, player.key().as_ref()], bump)]
    pub table: Account<'info, BlackjackTable>,
    pub system_program: Program<'info, System>,
}

pub fn open_table(ctx: Context<OpenTable>) -> Result<()> {
    ctx.accounts.table.player = ctx.accounts.player.key();
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateTable<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the table PDA handed to the rollup
    #[account(mut, del, seeds = [TABLE_SEED, player.key().as_ref()], bump)]
    pub table: UncheckedAccount<'info>,
}

/// Moves the table into the rollup for good, on the configured validator only.
pub fn delegate_table(ctx: Context<DelegateTable>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_table(
        &ctx.accounts.payer,
        &[TABLE_SEED, player.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            // No commits: the table only matters in the rollup.
            ..Default::default()
        },
    )?;
    Ok(())
}
