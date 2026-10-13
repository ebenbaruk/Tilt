//! Paying withdrawals and releasing reservations on Solana without trusting the rollup blindly.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{DAY_SECS, VAULT_SEED};
use crate::errors::TiltError;
use crate::state::{Config, Ledger, PlayerAccount, Vault};

/// What Solana is willing to pay for a claim coming from the rollup. Whatever the rollup
/// says, a player can never have been credited more than they really deposited on Solana,
/// nor take out more than those deposits, minus released losses, plus their win cap.
pub fn checked_due(claim: &PlayerAccount, ledger: &Ledger) -> Result<u64> {
    require_keys_eq!(claim.player, ledger.player, TiltError::FraudSuspected);
    require!(
        claim.credited <= ledger.deposited,
        TiltError::FraudSuspected
    );
    let allowance = ledger.deposited as u128 - ledger.forfeited as u128 + ledger.max_win as u128;
    require!(
        claim.withdrawn as u128 <= allowance,
        TiltError::FraudSuspected
    );
    Ok(claim.withdrawn.saturating_sub(ledger.withdrawn_paid))
}

/// A 24 h block of automatic payments. Blocks are fixed: `paid` resets when a block ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub start: i64,
    pub paid: u64,
}

impl Window {
    pub(crate) fn rolled(self, now: i64) -> Self {
        if now - self.start >= DAY_SECS {
            Self {
                start: now,
                paid: 0,
            }
        } else {
            self
        }
    }
}

/// Part of a payment that is house money: what takes the player's total withdrawals beyond
/// what is still theirs (deposits minus losses already released to the house). Players getting
/// their own money back never use up the global cap, so round-tripping deposits cannot hold
/// everyone else's winnings; winning back released losses does count.
pub fn house_part(ledger: &Ledger, withdrawn_total: u64) -> u64 {
    let own = ledger.deposited.saturating_sub(ledger.forfeited);
    let beyond = |withdrawn: u64| withdrawn.saturating_sub(own);
    beyond(withdrawn_total).saturating_sub(beyond(ledger.withdrawn_paid))
}

/// Whether an amount due can be paid automatically now. Returns the updated global and
/// player windows when it can, `None` when it must be held for review.
pub fn automatic_payment(
    config: &Config,
    global: Window,
    player: Window,
    due: u64,
    house_due: u64,
    now: i64,
) -> Option<(Window, Window)> {
    let (global, player) = (global.rolled(now), player.rolled(now));
    let allowed = !config.payouts_paused
        && due <= config.max_withdrawal
        && global.paid + house_due <= config.daily_cap
        && player.paid + due <= config.player_daily_cap;
    allowed.then_some((
        Window {
            start: global.start,
            paid: global.paid + house_due,
        },
        Window {
            start: player.start,
            paid: player.paid + due,
        },
    ))
}

pub fn read_claim(committed: &AccountInfo) -> Result<PlayerAccount> {
    let data = committed.try_borrow_data()?;
    PlayerAccount::try_deserialize(&mut &data[..])
}

#[event]
pub struct WithdrawalPaid {
    pub player: Pubkey,
    pub amount: u64,
    pub withdrawn_total: u64,
}

#[event]
pub struct WithdrawalHeld {
    pub player: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LossReleased {
    pub player: Pubkey,
    pub amount: u64,
    pub forfeited_total: u64,
}

pub struct PayAccounts<'a, 'info> {
    pub vault: &'a mut Account<'info, Vault>,
    pub vault_token: &'a Account<'info, TokenAccount>,
    pub player_token: &'a Account<'info, TokenAccount>,
    pub mint: &'a Account<'info, Mint>,
    pub ledger: &'a mut Account<'info, Ledger>,
    pub token_program: &'a Program<'info, Token>,
}

/// Pays what is due for the last state the rollup committed. With `enforce_limits`,
/// amounts outside the automatic limits are held instead.
pub fn pay_due(accounts: PayAccounts, committed: &AccountInfo, enforce_limits: bool) -> Result<()> {
    let claim = read_claim(committed)?;
    let PayAccounts {
        vault,
        vault_token,
        player_token,
        mint,
        ledger,
        token_program,
    } = accounts;
    let due = checked_due(&claim, ledger)?;
    if due == 0 {
        return Ok(());
    }
    if enforce_limits {
        let now = Clock::get()?.unix_timestamp;
        let global = Window {
            start: vault.window_start,
            paid: vault.window_paid,
        };
        let player = Window {
            start: ledger.window_start,
            paid: ledger.window_paid,
        };
        let house_due = house_part(ledger, claim.withdrawn);
        let Some((global, player)) =
            automatic_payment(&vault.config, global, player, due, house_due, now)
        else {
            emit!(WithdrawalHeld {
                player: claim.player,
                amount: due
            });
            return Ok(());
        };
        (vault.window_start, vault.window_paid) = (global.start, global.paid);
        (ledger.window_start, ledger.window_paid) = (player.start, player.paid);
    }
    require!(vault_token.amount >= due, TiltError::VaultTooSmall);
    ledger.withdrawn_paid = claim.withdrawn;
    vault.reserved -= due;

    let seeds: &[&[u8]] = &[VAULT_SEED, &[vault.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_token.to_account_info(),
                mint: mint.to_account_info(),
                to: player_token.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[seeds],
        ),
        due,
        mint.decimals,
    )?;
    emit!(WithdrawalPaid {
        player: claim.player,
        amount: due,
        withdrawn_total: claim.withdrawn
    });
    Ok(())
}

/// Losses the rollup reports beyond what Solana already released. A lying rollup can only
/// over-report, which shrinks the player's allowance by the same amount, and never past what
/// was already paid out, so the player's reservation never goes negative.
pub fn checked_forfeit(claim: &PlayerAccount, ledger: &Ledger) -> Result<u64> {
    require_keys_eq!(claim.player, ledger.player, TiltError::FraudSuspected);
    require!(
        claim.forfeited as u128 + ledger.withdrawn_paid as u128
            <= ledger.deposited as u128 + ledger.max_win as u128
            && claim.forfeited <= ledger.deposited,
        TiltError::FraudSuspected
    );
    Ok(claim.forfeited.saturating_sub(ledger.forfeited))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger(deposited: u64, withdrawn_paid: u64, max_win: u64) -> Ledger {
        Ledger {
            player: Pubkey::default(),
            deposited,
            withdrawn_paid,
            forfeited: 0,
            max_win,
            window_start: 0,
            window_paid: 0,
        }
    }

    fn claim(credited: u64, withdrawn: u64) -> PlayerAccount {
        PlayerAccount {
            credited,
            withdrawn,
            ..PlayerAccount::default()
        }
    }

    fn config() -> Config {
        Config {
            min_bet: 0,
            max_bet: 0,
            max_round_gain: 0,
            max_player_win: 0,
            max_win_multiple: 0,
            onboarding_fee: 0,
            min_deposit: 0,
            min_withdrawal: 0,
            max_withdrawal: 100,
            player_daily_cap: 150,
            daily_cap: 1_000,
            round_timeout_secs: 0,
            validator: Pubkey::default(),
            vrf_queue: Pubkey::default(),
            deposits_paused: false,
            bets_paused: false,
            payouts_paused: false,
        }
    }

    const EMPTY: Window = Window { start: 0, paid: 0 };

    #[test]
    fn honest_claim_pays_only_the_unpaid_part() {
        assert_eq!(
            checked_due(&claim(100, 130), &ledger(100, 50, 50)).unwrap(),
            80
        );
    }

    #[test]
    fn claim_crediting_deposits_that_never_happened_is_refused() {
        assert!(checked_due(&claim(1_000, 10), &ledger(100, 0, 50)).is_err());
    }

    #[test]
    fn claim_withdrawing_more_than_deposits_plus_win_cap_is_refused() {
        assert!(checked_due(&claim(100, 151), &ledger(100, 0, 50)).is_err());
        assert_eq!(
            checked_due(&claim(100, 150), &ledger(100, 0, 50)).unwrap(),
            150
        );
    }

    #[test]
    fn released_losses_shrink_the_allowance() {
        let mut l = ledger(100, 0, 50);
        l.forfeited = 60;
        assert!(checked_due(&claim(100, 91), &l).is_err());
        assert_eq!(checked_due(&claim(100, 90), &l).unwrap(), 90);
    }

    #[test]
    fn claim_for_another_player_is_refused() {
        let mut c = claim(100, 10);
        c.player = Pubkey::new_unique();
        assert!(checked_due(&c, &ledger(100, 0, 50)).is_err());
    }

    #[test]
    fn replayed_claim_pays_nothing() {
        assert_eq!(
            checked_due(&claim(100, 80), &ledger(100, 80, 50)).unwrap(),
            0
        );
    }

    #[test]
    fn forfeits_are_bounded_and_only_count_once() {
        let mut c = claim(100, 0);
        c.forfeited = 70;
        let mut l = ledger(100, 0, 50);
        assert_eq!(checked_forfeit(&c, &l).unwrap(), 70);
        l.forfeited = 70;
        assert_eq!(checked_forfeit(&c, &l).unwrap(), 0, "replay");
        c.forfeited = 101;
        assert!(checked_forfeit(&c, &l).is_err(), "more than deposited");
        // 100 deposited + 50 max win, 120 already paid: at most 30 can still be forfeited.
        let paid = ledger(100, 120, 50);
        c.forfeited = 31;
        assert!(
            checked_forfeit(&c, &paid).is_err(),
            "would leave a negative reservation"
        );
        c.forfeited = 30;
        assert_eq!(checked_forfeit(&c, &paid).unwrap(), 30);
    }

    #[test]
    fn limits_hold_large_paused_or_over_cap_payments() {
        let c = config();
        assert!(automatic_payment(&c, EMPTY, EMPTY, 100, 100, 10).is_some());
        assert!(
            automatic_payment(&c, EMPTY, EMPTY, 101, 0, 10).is_none(),
            "over max_withdrawal"
        );
        let paused = Config {
            payouts_paused: true,
            ..config()
        };
        assert!(
            automatic_payment(&paused, EMPTY, EMPTY, 1, 0, 10).is_none(),
            "paused"
        );
        let player = Window {
            start: 10,
            paid: 100,
        };
        assert!(
            automatic_payment(&c, EMPTY, player, 60, 0, 20).is_none(),
            "player daily cap"
        );
        let global = Window {
            start: 10,
            paid: 950,
        };
        assert!(
            automatic_payment(&c, global, EMPTY, 60, 60, 20).is_none(),
            "global daily cap"
        );
        assert!(
            automatic_payment(&c, global, EMPTY, 60, 0, 20).is_some(),
            "own deposits do not use the global cap"
        );
    }

    #[test]
    fn only_money_beyond_the_players_deposits_counts_as_house_money() {
        let l = ledger(100, 40, 50); // deposited 100, 40 already paid
        assert_eq!(house_part(&l, 90), 0, "still within own deposits");
        assert_eq!(house_part(&l, 130), 30);
        let past = ledger(100, 120, 50); // already 20 beyond deposits
        assert_eq!(house_part(&past, 150), 30);
        let lost = Ledger {
            forfeited: 90,
            ..ledger(100, 0, 50)
        };
        assert_eq!(
            house_part(&lost, 30),
            20,
            "released losses won back are house money"
        );
    }

    #[test]
    fn windows_reset_after_a_day() {
        let c = config();
        let player = Window {
            start: 0,
            paid: 150,
        };
        assert!(automatic_payment(&c, EMPTY, player, 50, 50, DAY_SECS - 1).is_none());
        let (global, player) = automatic_payment(&c, EMPTY, player, 50, 50, DAY_SECS).unwrap();
        assert_eq!((player.start, player.paid), (DAY_SECS, 50));
        assert_eq!((global.start, global.paid), (DAY_SECS, 50));
    }
}
