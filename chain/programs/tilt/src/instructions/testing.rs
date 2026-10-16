//! Fixtures shared by the instruction tests.

use anchor_lang::prelude::*;

use crate::state::{Config, PlayerAccount};

pub fn config() -> Config {
    Config {
        min_bet: 106,
        max_bet: 1_000_000,
        max_round_gain: 50_000_000,
        max_player_win: 100_000_000,
        max_win_multiple: 10,
        onboarding_fee: 0,
        min_deposit: 2,
        min_withdrawal: 1,
        max_withdrawal: 1_000,
        player_daily_cap: 1_000,
        daily_cap: 1_000,
        round_timeout_secs: 60,
        validator: Pubkey::new_unique(),
        vrf_queue: Pubkey::new_unique(),
        deposits_paused: false,
        bets_paused: false,
        payouts_paused: false,
    }
}

/// A player with 10 000 000 deposited and a 100 000 000 win cap.
pub fn account() -> PlayerAccount {
    PlayerAccount {
        credited: 10_000_000,
        balance: 10_000_000,
        max_win: 100_000_000,
        ..PlayerAccount::default()
    }
}
