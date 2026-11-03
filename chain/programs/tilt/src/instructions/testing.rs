//! Fixtures shared by the instruction tests.

use anchor_lang::prelude::*;

use crate::risk::RiskPool;
use crate::state::{Bankroll, Config, PlayerAccount, Vault};

pub fn config() -> Config {
    Config {
        min_bet: 106,
        max_bet: 1_000_000,
        max_round_gain: 50_000_000,
        onboarding_fee: 0,
        min_deposit: 2,
        min_withdrawal: 1,
        max_withdrawal: 1_000,
        player_daily_cap: 1_000,
        daily_cap: 1_000,
        round_timeout_secs: 60,
        abandoned_round_secs: 21_600,
        validator: Pubkey::new_unique(),
        vrf_queue: Pubkey::new_unique(),
        deposits_paused: false,
        bets_paused: false,
        payouts_paused: false,
    }
}

/// A player with 10 000 000 deposited.
pub fn account() -> PlayerAccount {
    PlayerAccount {
        credited: 10_000_000,
        balance: 10_000_000,
        ..PlayerAccount::default()
    }
}

/// `config` with a risk pool whose line covers anything.
pub fn bank<'a>(config: &'a Config, pool: &'a mut RiskPool) -> Bankroll<'a> {
    Bankroll {
        config,
        pool,
        line: u64::MAX,
    }
}

/// A risk pool holding just `account`'s open round and uncovered wins, as a round's own
/// pool would when it settles.
pub fn pool_of(account: &PlayerAccount) -> RiskPool {
    let pooled = account.round.pooled;
    RiskPool {
        gains: pooled.gain.into(),
        stakes: pooled.stake.into(),
        exposure: pooled.gain as u128 * pooled.stake as u128,
        uncovered: account.uncovered,
        ..RiskPool::default()
    }
}

/// An empty vault with `config()`.
pub fn vault() -> Vault {
    Vault {
        admin: Pubkey::new_unique(),
        relayer: Pubkey::new_unique(),
        mint: Pubkey::new_unique(),
        treasury: Pubkey::new_unique(),
        bump: 0,
        token_bump: 0,
        reserved: 0,
        config: config(),
        window_start: 0,
        window_paid: 0,
        pool_line: 0,
        pool_transferred: 0,
    }
}
