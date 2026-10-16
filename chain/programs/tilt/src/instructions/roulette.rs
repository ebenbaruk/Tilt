//! Multi-chip roulette (`roulette_chips`): the player's `RouletteTable` is opened on Solana and
//! delegated like the one-draw table; spins play in the rollup. A spin takes one VRF draw,
//! answered by `consume_roulette_randomness`, which settles the round. Single-bet spins
//! (`roulette_spin`) still play on the player account alone.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{ACCOUNT_SEED, LEDGER_SEED, ROULETTE_SEED, VAULT_SEED};
use crate::errors::TiltError;
use crate::games::roulette::{self, RouletteChip, RouletteTable};
use crate::instructions::play::{
    callback_account, draw_request, expired_draw, now, pending_draw, settle_round,
};
use crate::rng::Rng;
use crate::state::{Config, Draw, Game, Ledger, PlayerAccount, Round, Vault};

#[derive(Accounts)]
pub struct OpenRouletteTable<'info> {
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
    #[account(init, payer = payer, space = 8 + RouletteTable::INIT_SPACE, seeds = [ROULETTE_SEED, player.key().as_ref()], bump)]
    pub roulette: Account<'info, RouletteTable>,
    pub system_program: Program<'info, System>,
}

pub fn open_roulette_table(ctx: Context<OpenRouletteTable>) -> Result<()> {
    let roulette = &mut ctx.accounts.roulette;
    **roulette = RouletteTable {
        player: ctx.accounts.player.key(),
        ..RouletteTable::default()
    };
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRouletteTable<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the PDAs
    pub player: UncheckedAccount<'info>,
    /// CHECK: the table PDA handed to the rollup
    #[account(mut, del, seeds = [ROULETTE_SEED, player.key().as_ref()], bump)]
    pub roulette: UncheckedAccount<'info>,
}

/// Moves the table into the rollup for good, on the configured validator only.
pub fn delegate_roulette_table(ctx: Context<DelegateRouletteTable>) -> Result<()> {
    let player = ctx.accounts.player.key();
    let validator = ctx.accounts.vault.config.validator;
    ctx.accounts.delegate_roulette(
        &ctx.accounts.payer,
        &[ROULETTE_SEED, player.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            // No commits: the table only matters in the rollup.
            ..Default::default()
        },
    )?;
    Ok(())
}

#[vrf]
#[derive(Accounts)]
pub struct RoulettePlay<'info> {
    /// Read-only copy of the Solana vault: relayer key and limits.
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    /// The Tilt relay, acting on the player's intents.
    #[account(mut, address = vault.relayer @ TiltError::Unauthorized)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    /// Read-only copy of the Solana ledger, to credit new deposits.
    #[account(seeds = [LEDGER_SEED, account.player.as_ref()], bump)]
    pub ledger: Account<'info, Ledger>,
    #[account(mut, seeds = [ROULETTE_SEED, account.player.as_ref()], bump)]
    pub roulette: Account<'info, RouletteTable>,
    /// CHECK: the configured MagicBlock VRF queue; also validated by the VRF program
    #[account(mut, address = vault.config.vrf_queue @ TiltError::Unauthorized)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeRouletteRandomness<'info> {
    /// Must be a player account PDA, like in `consume_randomness`.
    #[account(mut, seeds = [ACCOUNT_SEED, account.player.as_ref()], bump)]
    pub account: Account<'info, PlayerAccount>,
    #[account(mut, seeds = [ROULETTE_SEED, account.player.as_ref()], bump)]
    pub roulette: Account<'info, RouletteTable>,
}

/// Takes the stake of a new spin of `chips` after checking the layout: bet limits apply to
/// each chip, and the best pocket's gain must fit the round limit and the win cap.
fn start_chips(
    account: &mut PlayerAccount,
    table: &mut RouletteTable,
    chips: &[RouletteChip],
    config: &Config,
    now: i64,
) -> Result<()> {
    require!(roulette::chips_are_valid(chips), TiltError::InvalidBet);
    let max_gain = roulette::chips_max_gain(chips);
    account.start_round_of(
        Game::Roulette,
        chips.iter().map(|chip| chip.amount),
        max_gain,
        config,
        now,
    )?;
    table.start(chips);
    Ok(())
}

/// The answer to `request_id` plays the round only if it is the pending chips spin.
fn check_roulette_draw(round: &Round, table: &RouletteTable, request_id: u64) -> Result<()> {
    let draw = pending_draw(round, request_id)?;
    require!(
        draw == Draw::Spin && round.on_roulette_table() && table.n_chips > 0 && !table.landed(),
        TiltError::WrongState
    );
    Ok(())
}

/// Asks for the spin's draw, answered by `consume_roulette_randomness` with the player account
/// and the table.
fn request_roulette_draw(ctx: &mut Context<RoulettePlay>, client_seed: [u8; 32]) -> Result<()> {
    let accounts = vec![
        callback_account(ctx.accounts.account.key()),
        callback_account(ctx.accounts.roulette.key()),
    ];
    let ix = draw_request(
        &mut ctx.accounts.account.round,
        Draw::Spin,
        ctx.accounts.payer.key(),
        ctx.accounts.oracle_queue.key(),
        crate::instruction::ConsumeRouletteRandomness::DISCRIMINATOR,
        accounts,
        client_seed,
    )?;
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// One spin with up to 20 chips, each on its own bet and amount; the stake is their total.
pub fn roulette_chips(
    mut ctx: Context<RoulettePlay>,
    chips: Vec<RouletteChip>,
    client_seed: [u8; 32],
) -> Result<()> {
    let accounts = &mut ctx.accounts;
    accounts.account.sync_ledger(&accounts.ledger);
    start_chips(
        &mut accounts.account,
        &mut accounts.roulette,
        &chips,
        &accounts.vault.config,
        now()?,
    )?;
    request_roulette_draw(&mut ctx, client_seed)
}

/// Relay cron: requests an awaited draw again, like `expire_round`.
pub fn expire_roulette_round(mut ctx: Context<RoulettePlay>, client_seed: [u8; 32]) -> Result<()> {
    let round = &ctx.accounts.account.round;
    require!(round.on_roulette_table(), TiltError::WrongState);
    expired_draw(round, ctx.accounts.vault.config.round_timeout_secs)?;
    request_roulette_draw(&mut ctx, client_seed)
}

/// VRF callback for chips spins: lands the ball and settles the round.
pub fn consume_roulette_randomness(
    ctx: Context<ConsumeRouletteRandomness>,
    randomness: [u8; 32],
    request_id: u64,
) -> Result<()> {
    let accounts = ctx.accounts;
    check_roulette_draw(&accounts.account.round, &accounts.roulette, request_id)?;
    let gross = accounts.roulette.spin(&mut Rng::from_vrf(randomness));
    settle_round(&mut accounts.account, gross, request_id, randomness);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::roulette::{spin_pocket, RouletteBet, RouletteSpin, MAX_CHIPS};
    use crate::instructions::testing::{account, config};
    use crate::settlement::settle;
    use crate::state::RoundStatus;

    fn chip(bet: RouletteBet, amount: u64) -> RouletteChip {
        RouletteChip { bet, amount }
    }

    /// Straight 7 (100 000), red (200 000), first dozen (300 000).
    fn layout() -> Vec<RouletteChip> {
        vec![
            chip(RouletteBet::Straight(7), 100_000),
            chip(RouletteBet::Red, 200_000),
            chip(RouletteBet::Dozen(1), 300_000),
        ]
    }

    fn started(chips: &[RouletteChip]) -> Result<(PlayerAccount, RouletteTable)> {
        let (mut a, mut t) = (account(), RouletteTable::default());
        start_chips(&mut a, &mut t, chips, &config(), 0)?;
        Ok((a, t))
    }

    /// Requests the draw like the instructions do, then plays `randomness`.
    fn draw(a: &mut PlayerAccount, t: &mut RouletteTable, randomness: [u8; 32]) -> u64 {
        a.round.request_id += 1;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        check_roulette_draw(&a.round, t, a.round.request_id).unwrap();
        let gross = t.spin(&mut Rng::from_vrf(randomness));
        a.finish_round(settle(a.round.stake, gross));
        gross
    }

    /// Every chip paid by the single-bet rules on `pocket`.
    fn expected_gross(chips: &[RouletteChip], pocket: u8) -> u64 {
        chips
            .iter()
            .map(|c| {
                RouletteSpin {
                    bet: c.bet,
                    number: pocket,
                }
                .gross(c.amount)
            })
            .sum()
    }

    #[test]
    fn a_spin_takes_the_total_stake_and_one_draw_settles_every_chip() {
        let (a, t) = started(&layout()).unwrap();
        assert_eq!(a.balance, 10_000_000 - 600_000);
        assert_eq!((a.round.game, a.round.stake), (Game::Roulette, 600_000));
        assert!(a.round.on_roulette_table());
        assert_eq!(t.chips(), &layout()[..]);
        for seed in 0..40u8 {
            let mut a = a.clone();
            let mut t = RouletteTable {
                player: t.player,
                ..RouletteTable::default()
            };
            t.start(&layout());
            let before = a.balance;
            let randomness = [seed; 32];
            let gross = draw(&mut a, &mut t, randomness);
            let pocket = spin_pocket(&mut Rng::from_vrf(randomness));
            assert_eq!(t.pocket, pocket);
            assert_eq!(gross, expected_gross(&layout(), pocket), "pocket {pocket}");
            assert_eq!(a.round.status, RoundStatus::Idle);
            assert_eq!(a.balance, before + settle(600_000, gross).payout);
        }
        // The straight, red (7 is red) and the first dozen all win on 7.
        assert_eq!(expected_gross(&layout(), 7), 3_600_000 + 400_000 + 900_000);
    }

    #[test]
    fn layouts_outside_the_rules_are_refused_before_the_stake() {
        let bets: Vec<_> = (0..=36).map(RouletteBet::Straight).collect();
        let many = |n: usize| -> Vec<_> { bets.iter().take(n).map(|&b| chip(b, 106)).collect() };
        for chips in [
            vec![],
            many(MAX_CHIPS + 1),
            vec![chip(RouletteBet::Red, 106), chip(RouletteBet::Red, 200)],
            vec![chip(RouletteBet::Straight(37), 106)],
            vec![
                chip(RouletteBet::Odd, 106),
                chip(RouletteBet::Column(0), 106),
            ],
        ] {
            let (mut a, mut t) = (account(), RouletteTable::default());
            assert_eq!(
                start_chips(&mut a, &mut t, &chips, &config(), 0),
                Err(TiltError::InvalidBet.into()),
                "{chips:?}"
            );
            assert_eq!((a.balance, t.n_chips), (10_000_000, 0));
        }
        for n in 1..=MAX_CHIPS {
            started(&many(n)).unwrap();
        }
    }

    #[test]
    fn bet_limits_apply_to_each_chip() {
        // min 106, max 1 000 000 per chip.
        for amounts in [[105, 106], [106, 1_000_001], [0, 1_000]] {
            let chips = [
                chip(RouletteBet::Red, amounts[0]),
                chip(RouletteBet::Black, amounts[1]),
            ];
            assert_eq!(
                started(&chips).err(),
                Some(TiltError::AmountOutOfRange.into()),
                "{amounts:?}"
            );
        }
        // Twenty chips at the maximum: 20 000 000 staked, above any single bet.
        let mut a = account();
        a.balance = 20_000_000;
        let chips: Vec<_> = (0..20)
            .map(|n| chip(RouletteBet::Straight(n), 1_000_000))
            .collect();
        // The best pocket returns 36 000 000: a 16 000 000 gain, within the 50 000 000 limit.
        start_chips(&mut a, &mut RouletteTable::default(), &chips, &config(), 0).unwrap();
        assert_eq!((a.balance, a.round.stake), (0, 20_000_000));
    }

    #[test]
    fn the_best_pocket_must_fit_the_round_limit_and_the_win_cap() {
        let mut config = config();
        // Straight 7 + red + first dozen gain 4 300 000 on 7.
        config.max_round_gain = 4_299_999;
        let (mut a, mut t) = (account(), RouletteTable::default());
        assert_eq!(
            start_chips(&mut a, &mut t, &layout(), &config, 0),
            Err(TiltError::RoundGainTooHigh.into())
        );
        config.max_round_gain = 4_300_000;
        a.max_win = 4_299_999;
        assert_eq!(
            start_chips(&mut a, &mut t, &layout(), &config, 0),
            Err(TiltError::WinCapReached.into())
        );
        a.max_win = 4_300_000;
        start_chips(&mut a, &mut t, &layout(), &config, 0).unwrap();
        assert_eq!(a.balance, 10_000_000 - 600_000);
    }

    #[test]
    fn the_total_stake_must_be_covered() {
        let (mut a, mut t) = (account(), RouletteTable::default());
        a.balance = 599_999;
        assert_eq!(
            start_chips(&mut a, &mut t, &layout(), &config(), 0),
            Err(TiltError::InsufficientBalance.into())
        );
        assert_eq!(t.n_chips, 0);
    }

    #[test]
    fn stale_foreign_or_replayed_randomness_is_refused() {
        let (mut a, mut t) = started(&layout()).unwrap();
        assert_eq!(
            check_roulette_draw(&a.round, &t, a.round.request_id),
            Err(TiltError::StaleRandomness.into()),
            "nothing pending"
        );
        a.round.request_id = 5;
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        assert_eq!(
            check_roulette_draw(&a.round, &t, 4),
            Err(TiltError::StaleRandomness.into())
        );
        check_roulette_draw(&a.round, &t, 5).unwrap();
        // A single-bet spin plays on the player account, not the table.
        let mut single = a.round.clone();
        single.roulette = Some(RouletteSpin {
            bet: RouletteBet::Red,
            number: 0,
        });
        assert_eq!(
            check_roulette_draw(&single, &t, 5),
            Err(TiltError::WrongState.into())
        );
        let mut other = a.round.clone();
        other.game = Game::Slots;
        assert_eq!(
            check_roulette_draw(&other, &t, 5),
            Err(TiltError::WrongState.into())
        );
        a.round.status = RoundStatus::AwaitingDraw(Draw::Card);
        assert_eq!(
            check_roulette_draw(&a.round, &t, 5),
            Err(TiltError::WrongState.into())
        );
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        t.spin(&mut Rng::from_vrf([1; 32]));
        assert_eq!(
            check_roulette_draw(&a.round, &t, 5),
            Err(TiltError::WrongState.into()),
            "already landed"
        );
    }

    #[test]
    fn a_round_in_progress_blocks_a_new_spin() {
        let (mut a, mut t) = started(&layout()).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        let before = t.clone();
        assert_eq!(
            start_chips(
                &mut a,
                &mut t,
                &[chip(RouletteBet::Odd, 1_000)],
                &config(),
                0
            ),
            Err(TiltError::RoundInProgress.into())
        );
        assert_eq!(t, before, "a refused spin leaves the table alone");
    }

    #[test]
    fn a_chips_spin_never_plays_through_consume_randomness() {
        let (mut a, _) = started(&layout()).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        assert_eq!(
            a.round
                .apply_draw(Draw::Spin, &mut Rng::from_vrf([2; 32]), None),
            Err(TiltError::WrongState.into())
        );
    }
}
