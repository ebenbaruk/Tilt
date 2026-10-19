//! Paying withdrawals and releasing reservations on Solana without trusting the rollup blindly.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{DAY_SECS, VAULT_SEED};
use crate::errors::TiltError;
use crate::state::{Config, Ledger, PlayerAccount, Vault};

/// What Solana is willing to pay for a claim coming from the rollup. Whatever the rollup
/// says, a player can never have been credited more than they really deposited on Solana,
/// nor take out more than those deposits, minus released losses, plus their secured wins.
pub fn checked_due(claim: &PlayerAccount, ledger: &Ledger) -> Result<u64> {
    require_keys_eq!(claim.player, ledger.player, TiltError::FraudSuspected);
    require!(
        claim.credited <= ledger.deposited,
        TiltError::FraudSuspected
    );
    let allowance = ledger.deposited as u128 - ledger.forfeited as u128 + ledger.secured() as u128;
    require!(
        claim.withdrawn as u128 <= allowance,
        TiltError::FraudSuspected
    );
    Ok(claim.withdrawn.saturating_sub(ledger.withdrawn_paid))
}

/// Takes a committed claim's secured wins onto Solana, before anything is paid or released:
/// wins the risk pool moved to the player (`win_reserved`) come out of the pool's line, wins
/// lost again (`win_released`) go back to the house. Returns the wins released. Whatever the
/// rollup says, the pool's line is never overdrawn, nothing is released twice, and the
/// player's allowance never falls below what was already paid. An older claim changes
/// nothing: both totals only grow.
pub fn apply_secured_wins(
    vault: &mut Vault,
    ledger: &mut Ledger,
    claim: &PlayerAccount,
) -> Result<u64> {
    require_keys_eq!(claim.player, ledger.player, TiltError::FraudSuspected);
    let transferred = claim.win_reserved.saturating_sub(ledger.win_reserved);
    let win_reserved = ledger.win_reserved + transferred;
    let win_released = ledger.win_released.max(claim.win_released);
    let pool_transferred = vault.pool_transferred as u128 + transferred as u128;
    let allowance = ledger.deposited as u128 - ledger.forfeited as u128 + win_reserved as u128
        - win_released.min(win_reserved) as u128;
    require!(
        win_released <= win_reserved
            && pool_transferred <= vault.pool_line as u128
            && allowance >= ledger.withdrawn_paid as u128,
        TiltError::FraudSuspected
    );
    let released = win_released - ledger.win_released;
    vault.pool_transferred += transferred;
    vault.reserved -= released;
    ledger.win_reserved = win_reserved;
    ledger.win_released = win_released;
    Ok(released)
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

/// Secured wins the player lost again, back to the house.
#[event]
pub struct WinsReleased {
    pub player: Pubkey,
    pub amount: u64,
    pub released_total: u64,
}

pub struct PayAccounts<'a, 'info> {
    pub vault: &'a mut Account<'info, Vault>,
    pub vault_token: &'a Account<'info, TokenAccount>,
    pub player_token: &'a Account<'info, TokenAccount>,
    pub mint: &'a Account<'info, Mint>,
    pub ledger: &'a mut Account<'info, Ledger>,
    pub token_program: &'a Program<'info, Token>,
}

/// Pays what is due for the last state the rollup committed, once its secured wins are on
/// Solana. With `enforce_limits`, amounts outside the automatic limits are held instead.
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
    let released = apply_secured_wins(vault, ledger, &claim)?;
    if released > 0 {
        emit!(WinsReleased {
            player: claim.player,
            amount: released,
            released_total: ledger.win_released
        });
    }
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
            <= ledger.deposited as u128 + ledger.secured() as u128
            && claim.forfeited <= ledger.deposited,
        TiltError::FraudSuspected
    );
    Ok(claim.forfeited.saturating_sub(ledger.forfeited))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ledger whose player has `secured` wins on Solana.
    fn ledger(deposited: u64, withdrawn_paid: u64, secured: u64) -> Ledger {
        Ledger {
            player: Pubkey::default(),
            deposited,
            withdrawn_paid,
            forfeited: 0,
            win_reserved: secured,
            win_released: 0,
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

    /// A vault whose risk pool has a line of `line`, of which `transferred` went to players.
    fn vault(reserved: u64, line: u64, transferred: u64) -> Vault {
        Vault {
            reserved,
            pool_line: line,
            pool_transferred: transferred,
            ..crate::instructions::testing::vault()
        }
    }

    fn securing(win_reserved: u64, win_released: u64) -> PlayerAccount {
        PlayerAccount {
            win_reserved,
            win_released,
            ..PlayerAccount::default()
        }
    }

    #[test]
    fn wins_secured_in_the_rollup_come_out_of_the_pools_line() {
        let (mut v, mut l) = (vault(1_000, 500, 100), ledger(100, 0, 0));
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 0)).unwrap(),
            0
        );
        // The line was already reserved: moving it to the player leaves `reserved` as it was.
        assert_eq!(
            (v.reserved, v.pool_transferred, l.win_reserved),
            (1_000, 400, 300)
        );
        assert_eq!(checked_due(&claim(100, 400), &l).unwrap(), 400);
    }

    #[test]
    fn a_claim_overdrawing_the_pools_line_is_refused() {
        let (mut v, mut l) = (vault(1_000, 500, 400), ledger(100, 0, 0));
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(101, 0)),
            Err(TiltError::FraudSuspected.into())
        );
        apply_secured_wins(&mut v, &mut l, &securing(100, 0)).unwrap();
        assert_eq!(v.pool_transferred, 500);
    }

    #[test]
    fn wins_lost_again_go_back_to_the_house_once() {
        let (mut v, mut l) = (vault(1_000, 500, 300), ledger(100, 0, 300));
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 200)).unwrap(),
            200
        );
        assert_eq!((v.reserved, l.secured()), (800, 100));
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 200)).unwrap(),
            0,
            "replay"
        );
        assert_eq!(v.reserved, 800);
    }

    #[test]
    fn an_older_claim_changes_nothing() {
        let (mut v, mut l) = (vault(1_000, 500, 300), ledger(100, 0, 300));
        l.win_released = 200;
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(100, 50)).unwrap(),
            0
        );
        assert_eq!(
            (
                v.reserved,
                v.pool_transferred,
                l.win_reserved,
                l.win_released
            ),
            (1_000, 300, 300, 200)
        );
    }

    #[test]
    fn releasing_wins_already_paid_out_is_refused() {
        // 100 deposited + 300 secured, 350 already paid: at most 50 can still be released.
        let (mut v, mut l) = (vault(1_000, 500, 300), ledger(100, 350, 300));
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 51)),
            Err(TiltError::FraudSuspected.into())
        );
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 50)).unwrap(),
            50
        );
        assert_eq!(
            apply_secured_wins(&mut v, &mut l, &securing(300, 301)),
            Err(TiltError::FraudSuspected.into()),
            "more than ever secured"
        );
    }

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
