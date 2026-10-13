//! Promo payouts (spec §9): sponsor prize pools paid straight to players' wallets, on Solana.
//! The pool is a separate token account from the bankroll: it is never reserved for players,
//! and a leaked relayer key can at most pay out the pool's daily cap per 24 h block (twice
//! that around a block boundary). Fund the pool as it is spent rather than all at once.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{PAYOUT_SEED, PROMO_SEED, PROMO_TOKEN_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::state::Vault;
use crate::withdrawals::Window;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct PromoConfig {
    /// Largest single payout.
    pub max_payout: u64,
    /// Paid out per 24 h block (fixed blocks, like withdrawals).
    pub daily_cap: u64,
    pub paused: bool,
}

impl PromoConfig {
    fn validate(&self) -> Result<()> {
        require!(
            self.max_payout > 0 && self.daily_cap >= self.max_payout,
            TiltError::InvalidConfig
        );
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct PromoPool {
    pub bump: u8,
    pub token_bump: u8,
    pub config: PromoConfig,
    pub window_start: i64,
    pub window_paid: u64,
    pub paid_total: u64,
}

/// One per payout id: a payout can never be made twice, whatever the relay does.
#[account]
#[derive(InitSpace)]
pub struct PromoPayout {
    /// Owner of the token account that was paid.
    pub player: Pubkey,
    pub amount: u64,
    pub paid_at: i64,
}

#[event]
pub struct PromoPaid {
    pub payout_id: [u8; 16],
    pub player: Pubkey,
    pub amount: u64,
}

/// The pool's window after paying `amount` now, or `None` if the payout is not allowed.
pub fn promo_payment(
    config: &PromoConfig,
    window: Window,
    amount: u64,
    now: i64,
) -> Option<Window> {
    let window = window.rolled(now);
    let paid = window.paid.checked_add(amount)?;
    (!config.paused && amount > 0 && amount <= config.max_payout && paid <= config.daily_cap)
        .then_some(Window {
            start: window.start,
            paid,
        })
}

#[derive(Accounts)]
pub struct InitPromo<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = admin @ TiltError::Unauthorized, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = admin, space = 8 + PromoPool::INIT_SPACE, seeds = [PROMO_SEED], bump)]
    pub promo: Account<'info, PromoPool>,
    #[account(init, payer = admin, seeds = [PROMO_TOKEN_SEED], bump, token::mint = mint, token::authority = promo)]
    pub promo_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn init_promo(ctx: Context<InitPromo>, config: PromoConfig) -> Result<()> {
    config.validate()?;
    let promo = &mut ctx.accounts.promo;
    promo.bump = ctx.bumps.promo;
    promo.token_bump = ctx.bumps.promo_token;
    promo.config = config;
    Ok(())
}

#[derive(Accounts)]
pub struct SetPromo<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = admin @ TiltError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [PROMO_SEED], bump = promo.bump)]
    pub promo: Account<'info, PromoPool>,
}

pub fn set_promo(ctx: Context<SetPromo>, config: PromoConfig) -> Result<()> {
    config.validate()?;
    ctx.accounts.promo.config = config;
    Ok(())
}

#[derive(Accounts)]
pub struct FundPromo<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [PROMO_SEED], bump = promo.bump)]
    pub promo: Account<'info, PromoPool>,
    #[account(mut, seeds = [PROMO_TOKEN_SEED], bump = promo.token_bump)]
    pub promo_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub source: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Adds sponsor money to the pool (anyone may fund it).
pub fn fund_promo(ctx: Context<FundPromo>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    token::transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.source.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.promo_token.to_account_info(),
                authority: a.funder.to_account_info(),
            },
        ),
        amount,
        a.mint.decimals,
    )
}

#[derive(Accounts)]
#[instruction(payout_id: [u8; 16])]
pub struct PayPromo<'info> {
    /// The relay: decides who won (off-chain competitions and drops), pays the payout record's rent.
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump = vault.bump, has_one = relayer @ TiltError::Unauthorized, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [PROMO_SEED], bump = promo.bump)]
    pub promo: Account<'info, PromoPool>,
    #[account(mut, seeds = [PROMO_TOKEN_SEED], bump = promo.token_bump)]
    pub promo_token: Account<'info, TokenAccount>,
    #[account(init, payer = relayer, space = 8 + PromoPayout::INIT_SPACE, seeds = [PAYOUT_SEED, &payout_id], bump)]
    pub payout: Account<'info, PromoPayout>,
    #[account(mut, token::mint = mint)]
    pub player_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn pay_promo(ctx: Context<PayPromo>, payout_id: [u8; 16], amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let window = Window {
        start: a.promo.window_start,
        paid: a.promo.window_paid,
    };
    let window = match promo_payment(&a.promo.config, window, amount, now) {
        Some(window) => window,
        None if a.promo.config.paused => return err!(TiltError::Paused),
        None => return err!(TiltError::PromoCapReached),
    };
    (a.promo.window_start, a.promo.window_paid) = (window.start, window.paid);
    a.promo.paid_total = a
        .promo
        .paid_total
        .checked_add(amount)
        .ok_or(TiltError::AmountOutOfRange)?;
    a.payout.set_inner(PromoPayout {
        player: a.player_token.owner,
        amount,
        paid_at: now,
    });

    let seeds: &[&[u8]] = &[PROMO_SEED, &[a.promo.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.promo_token.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.player_token.to_account_info(),
                authority: a.promo.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.mint.decimals,
    )?;
    emit!(PromoPaid {
        payout_id,
        player: a.player_token.owner,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawPromo<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED],
        bump = vault.bump,
        has_one = admin @ TiltError::Unauthorized,
        has_one = mint,
        has_one = treasury,
    )]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [PROMO_SEED], bump = promo.bump)]
    pub promo: Account<'info, PromoPool>,
    #[account(mut, seeds = [PROMO_TOKEN_SEED], bump = promo.token_bump)]
    pub promo_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Takes unspent sponsor money back to the treasury (e.g. at the end of a season).
pub fn withdraw_promo(ctx: Context<WithdrawPromo>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let seeds: &[&[u8]] = &[PROMO_SEED, &[a.promo.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.promo_token.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.treasury.to_account_info(),
                authority: a.promo.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.mint.decimals,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::DAY_SECS;

    const CONFIG: PromoConfig = PromoConfig {
        max_payout: 100,
        daily_cap: 250,
        paused: false,
    };
    const EMPTY: Window = Window { start: 0, paid: 0 };

    #[test]
    fn payouts_stay_within_the_per_payout_and_daily_caps() {
        let w = promo_payment(&CONFIG, EMPTY, 100, 10).unwrap();
        let w = promo_payment(&CONFIG, w, 100, 20).unwrap();
        assert_eq!(
            w,
            Window {
                start: 0,
                paid: 200
            }
        );
        assert!(promo_payment(&CONFIG, w, 51, 30).is_none(), "daily cap");
        assert!(promo_payment(&CONFIG, w, 50, 30).is_some());
        assert!(
            promo_payment(&CONFIG, EMPTY, 101, 10).is_none(),
            "per-payout cap"
        );
        assert!(
            promo_payment(&CONFIG, EMPTY, 0, 10).is_none(),
            "empty payout"
        );
    }

    #[test]
    fn the_daily_cap_resets_with_the_next_block() {
        let full = Window {
            start: 0,
            paid: 250,
        };
        assert!(promo_payment(&CONFIG, full, 1, DAY_SECS - 1).is_none());
        assert_eq!(
            promo_payment(&CONFIG, full, 1, DAY_SECS),
            Some(Window {
                start: DAY_SECS,
                paid: 1
            })
        );
    }

    #[test]
    fn paused_pool_pays_nothing() {
        let paused = PromoConfig {
            paused: true,
            ..CONFIG
        };
        assert!(promo_payment(&paused, EMPTY, 1, 10).is_none());
    }

    #[test]
    fn config_needs_a_daily_cap_covering_one_payout() {
        assert!(CONFIG.validate().is_ok());
        assert!(PromoConfig {
            max_payout: 0,
            ..CONFIG
        }
        .validate()
        .is_err());
        assert!(PromoConfig {
            daily_cap: 99,
            ..CONFIG
        }
        .validate()
        .is_err());
    }
}
