use anchor_lang::prelude::*;

use crate::errors::TiltError;
use crate::games::{
    baccarat::BaccaratCoup,
    blackjack::{BlackjackTable, MAX_CARDS},
    roulette::RouletteSpin,
    slots::SlotsSpin,
};
use crate::rng::Rng;
use crate::settlement::Settlement;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct Config {
    /// Smallest stake; below it the 1% fee would round to nothing while Tilt still pays the round.
    pub min_bet: u64,
    /// Largest stake for one round, in USDC base units.
    pub max_bet: u64,
    /// Largest gain one round may produce (caps e.g. straight-up roulette and slot jackpots).
    pub max_round_gain: u64,
    /// Largest lifetime net win reserved for one player.
    pub max_player_win: u64,
    /// A player's reserved max win may not exceed this multiple of their first deposit.
    pub max_win_multiple: u64,
    /// What Tilt advances in SOL to open an account, kept in USDC from the first deposit.
    pub onboarding_fee: u64,
    /// Smallest deposit after the first one. At least `min_withdrawal`, so a dust deposit
    /// cannot be withdrawn right back through the "empty the balance" exception, each round
    /// trip making Tilt pay a commit.
    pub min_deposit: u64,
    /// Smaller withdrawals are refused unless they empty the balance (each one costs a commit).
    pub min_withdrawal: u64,
    /// Withdrawals above this are held for review.
    pub max_withdrawal: u64,
    /// Paid automatically to one player per 24 h block; beyond it, their withdrawals are held.
    /// Blocks are fixed, not rolling: up to twice this can go out around a block boundary.
    pub player_daily_cap: u64,
    /// House money (paid beyond players' own deposits) sent automatically per 24 h block.
    pub daily_cap: u64,
    /// A round untouched this long can be closed by the relayer.
    pub round_timeout_secs: i64,
    /// The only rollup validator player accounts may be delegated to.
    pub validator: Pubkey,
    /// The only MagicBlock VRF queue draws may come from.
    pub vrf_queue: Pubkey,
    pub deposits_paused: bool,
    pub bets_paused: bool,
    /// Holds every automatic payment (Tilt can still release after review).
    pub payouts_paused: bool,
}

impl Config {
    /// Refuses settings that would silently break play or payouts.
    pub fn validate(&self) -> Result<()> {
        use crate::settlement::{mul_div, BPS, FEE_BPS};
        require!(
            // Below BPS / FEE_BPS units of gain the 1% fee rounds to zero; the smallest gain
            // of a winning bet is a Banker win at baccarat, 95% of the stake.
            mul_div(self.min_bet, 95, 100) >= BPS / FEE_BPS
                && self.min_bet <= self.max_bet
                // Settlement multiplies stakes by up to the slots jackpot; a doubled blackjack
                // stake only returns 2x, well within this.
                && self.max_bet.checked_mul(crate::games::slots::MAX_MULTIPLE).is_some()
                // Even-money bets gain their stake: below this no bet could ever start.
                && self.max_round_gain >= self.min_bet
                && self.max_player_win >= self.min_bet
                && self.max_win_multiple > 0
                && self.min_deposit >= self.min_withdrawal
                && self.min_deposit > 0
                // Otherwise every withdrawal would be held, like a silent payout pause.
                && self.min_withdrawal <= self.max_withdrawal
                && self.max_withdrawal > 0
                && self.max_withdrawal <= self.player_daily_cap
                && self.max_withdrawal <= self.daily_cap
                && self.round_timeout_secs > 0
                && self.validator != Pubkey::default()
                && self.vrf_queue != Pubkey::default(),
            TiltError::InvalidConfig
        );
        Ok(())
    }
}

/// House state, on Solana. Owns the USDC token account that pays every player.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Configuration, roles and house funds (meant to be a multisig).
    pub admin: Pubkey,
    /// Hot key of the relay: plays for players and pays fees. Rotatable by the admin.
    pub relayer: Pubkey,
    pub mint: Pubkey,
    /// Receives onboarding fees and house withdrawals.
    pub treasury: Pubkey,
    pub bump: u8,
    pub token_bump: u8,
    /// What the vault may owe in the worst case: for every player,
    /// deposited - forfeited - withdrawn_paid + max_win.
    pub reserved: u64,
    pub config: Config,
    pub window_start: i64,
    pub window_paid: u64,
}

/// Solana's own record of a player, never written by the rollup. Claims coming back
/// from the rollup are checked against it.
#[account]
#[derive(InitSpace)]
pub struct Ledger {
    pub player: Pubkey,
    /// USDC credited to the player on Solana (onboarding fee already deducted).
    pub deposited: u64,
    pub withdrawn_paid: u64,
    /// Player losses released from the reservation (see `checkpoint`).
    pub forfeited: u64,
    /// The player's win cap: set at the first deposit, raised by `raise_win_cap` as they win.
    pub max_win: u64,
    pub window_start: i64,
    pub window_paid: u64,
}

impl Ledger {
    /// The rolling win cap: raises the player's cap by `amount`, reserved from the free
    /// bankroll `free`, so the vault still covers every player's worst case and a withdrawal
    /// is still checked against the cap. At most one round's largest gain at a time, and not
    /// while bets are paused.
    pub fn raise_win_cap(
        &mut self,
        reserved: &mut u64,
        free: u64,
        amount: u64,
        config: &Config,
    ) -> Result<()> {
        require!(!config.bets_paused, TiltError::Paused);
        require!(
            amount > 0 && amount <= config.max_round_gain,
            TiltError::AmountOutOfRange
        );
        require!(amount <= free, TiltError::VaultTooSmall);
        *reserved = reserved
            .checked_add(amount)
            .ok_or(TiltError::AmountOutOfRange)?;
        self.max_win = self
            .max_win
            .checked_add(amount)
            .ok_or(TiltError::AmountOutOfRange)?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum Game {
    Blackjack,
    Roulette,
    Baccarat,
    Slots,
    /// Appended last, like `Draw::Split`. Mines rounds play on `MinesBoard`, outside `apply_draw`.
    Mines,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum Draw {
    Deal,
    Hit,
    Double,
    Dealer,
    Spin,
    /// Appended last: `RoundStatus` lives in `PlayerAccount`, earlier bytes keep their meaning.
    Split,
    /// Mines: the pending tile is safe or a mine. Appended last.
    Reveal,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum RoundStatus {
    Idle,
    /// A VRF draw was requested; its callback (`consume_randomness`, or
    /// `consume_mines_randomness` for Mines) will continue the round.
    AwaitingDraw(Draw),
    /// Blackjack: waiting for hit, stand, double or split. Mines: waiting for a reveal or a
    /// cash-out.
    PlayerTurn,
}

/// Legacy single-hand blackjack state, never written since blackjack moved to
/// `BlackjackTable`. Kept only so `PlayerAccount` keeps its byte layout (accounts already
/// delegated, withdrawals deserialize it).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace, PartialEq, Eq, Debug)]
pub struct BlackjackHand {
    pub player: [u8; MAX_CARDS],
    pub n_player: u8,
    pub dealer: [u8; MAX_CARDS],
    pub n_dealer: u8,
    pub doubled: bool,
}

/// The current or last round. Lives in the player account, so an unfinished round
/// survives disconnections and can be resumed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct Round {
    pub game: Game,
    pub status: RoundStatus,
    /// Total stake, every blackjack hand, double and split included.
    pub stake: u64,
    pub last_action: i64,
    /// Id of the VRF request the round is waiting for; any other callback is refused.
    pub request_id: u64,
    pub payout: u64,
    pub fee: u64,
    /// Legacy, always default: blackjack rounds live in `BlackjackTable`.
    pub blackjack: BlackjackHand,
    pub roulette: Option<RouletteSpin>,
    pub baccarat: Option<BaccaratCoup>,
    pub slots: SlotsSpin,
}

impl Default for Round {
    fn default() -> Self {
        Self {
            game: Game::Blackjack,
            status: RoundStatus::Idle,
            stake: 0,
            last_action: 0,
            request_id: 0,
            payout: 0,
            fee: 0,
            blackjack: BlackjackHand::default(),
            roulette: None,
            baccarat: None,
            slots: SlotsSpin::default(),
        }
    }
}

impl Round {
    /// Plays a VRF draw. Returns the gross return once the round is over, or `None` when
    /// a blackjack hand goes back to the player. Blackjack draws play on `table`.
    pub fn apply_draw(
        &mut self,
        draw: Draw,
        rng: &mut Rng,
        table: Option<&mut BlackjackTable>,
    ) -> Result<Option<u64>> {
        let stake = self.stake;
        let gross = match (self.game, draw) {
            (
                Game::Blackjack,
                Draw::Deal | Draw::Hit | Draw::Double | Draw::Split | Draw::Dealer,
            ) => {
                let table = table.ok_or(TiltError::MissingTable)?;
                let over = match draw {
                    Draw::Deal => table.deal(rng),
                    Draw::Hit => table.hit(rng),
                    Draw::Double => table.double(rng),
                    Draw::Split => table.split(rng),
                    _ => {
                        table.play_dealer(rng);
                        true
                    }
                };
                if !over {
                    self.status = RoundStatus::PlayerTurn;
                    return Ok(None);
                }
                table.gross()
            }
            (Game::Roulette, Draw::Spin) => {
                let spin = self.roulette.as_mut().ok_or(TiltError::WrongState)?;
                spin.spin(rng);
                spin.gross(stake)
            }
            (Game::Baccarat, Draw::Spin) => {
                let coup = self.baccarat.as_mut().ok_or(TiltError::WrongState)?;
                coup.deal(rng);
                coup.gross(stake)
            }
            (Game::Slots, Draw::Spin) => {
                self.slots.spin(rng);
                self.slots.gross(stake)
            }
            _ => return err!(TiltError::WrongState),
        };
        Ok(Some(gross))
    }
}

/// The player's balance and current round. Lives in the rollup permanently.
#[account]
#[derive(InitSpace, Default)]
pub struct PlayerAccount {
    pub player: Pubkey,
    pub max_win: u64,
    /// Deposits already credited from the ledger; never decreases.
    pub credited: u64,
    /// Losses released from the vault reservation by `checkpoint`; never decreases.
    pub forfeited: u64,
    /// Total ever withdrawn; never decreases.
    pub withdrawn: u64,
    pub balance: u64,
    pub rounds: u32,
    /// Tilt's 1% fees taken from this player's winning rounds.
    pub fees: u64,
    pub round: Round,
}

/// Logged before a `WinCapReached` refusal, then the shortfall in USDC base units: the relay
/// raises the cap by exactly that (`raise_win_cap`), no more bankroll than the move needs.
pub const WIN_CAP_SHORT_LOG: &str = "Win cap short by ";

impl PlayerAccount {
    /// Takes what Solana recorded since the last move: deposits (credited at most once) and a
    /// raised win cap. A stale ledger copy can never make either go back.
    pub fn sync_ledger(&mut self, ledger: &Ledger) {
        if ledger.deposited > self.credited {
            self.balance += ledger.deposited - self.credited;
            self.credited = ledger.deposited;
        }
        self.max_win = self.max_win.max(ledger.max_win);
    }

    /// Refuses a round whose worst case, from `start_balance` up by `max_gain`, passes the cap.
    fn check_win_cap(&self, start_balance: u64, max_gain: u64) -> Result<()> {
        let short = self.net_win(start_balance + max_gain) - self.max_win as i128;
        if short > 0 {
            msg!("{}{}", WIN_CAP_SHORT_LOG, short);
            return err!(TiltError::WinCapReached);
        }
        Ok(())
    }

    /// Net win so far if the balance were `balance`; losses already forfeited are not counted.
    pub fn net_win(&self, balance: u64) -> i128 {
        balance as i128 + self.withdrawn as i128 - (self.credited as i128 - self.forfeited as i128)
    }

    /// Takes a new round's stake, `bets` equal bets of `bet` (blackjack hands; 1 for other
    /// games), after checking limits: bet limits apply to each bet. `max_gain` is the most
    /// this round can win.
    pub fn start_round(
        &mut self,
        game: Game,
        bet: u64,
        bets: u8,
        max_gain: u64,
        config: &Config,
        now: i64,
    ) -> Result<()> {
        require!(!config.bets_paused, TiltError::Paused);
        require!(
            self.round.status == RoundStatus::Idle,
            TiltError::RoundInProgress
        );
        require!(
            bet >= config.min_bet && bet <= config.max_bet && bets > 0,
            TiltError::AmountOutOfRange
        );
        let stake = bet
            .checked_mul(bets.into())
            .ok_or(TiltError::AmountOutOfRange)?;
        require!(
            max_gain <= config.max_round_gain,
            TiltError::RoundGainTooHigh
        );
        require!(self.balance >= stake, TiltError::InsufficientBalance);
        self.check_win_cap(self.balance, max_gain)?;
        self.balance -= stake;
        self.round = Round {
            game,
            stake,
            last_action: now,
            request_id: self.round.request_id,
            ..Round::default()
        };
        Ok(())
    }

    /// Takes one more blackjack base bet `bet` mid-round (a split) after re-checking the
    /// round like `start_round` does, now with `hands` hands of `bet`: the worst case
    /// (every hand doubled and won) must stay within the round gain limit and the win cap.
    /// Nothing is reserved ahead for splits, so a split the limits cannot cover is refused.
    pub fn take_split(&mut self, bet: u64, hands: u8, config: &Config) -> Result<()> {
        let max_gain = crate::games::blackjack::max_gain(bet.saturating_mul(hands.into()));
        require!(
            max_gain <= config.max_round_gain,
            TiltError::RoundGainTooHigh
        );
        require!(self.balance >= bet, TiltError::InsufficientBalance);
        // The balance the round started from: what it has staked so far comes back to it.
        let start_balance = self.balance + self.round.stake;
        self.check_win_cap(start_balance, max_gain)?;
        self.balance -= bet;
        self.round.stake += bet;
        Ok(())
    }

    pub fn finish_round(&mut self, settlement: Settlement) {
        self.balance += settlement.payout;
        self.fees += settlement.fee;
        self.rounds += 1;
        self.round.payout = settlement.payout;
        self.round.fee = settlement.fee;
        self.round.status = RoundStatus::Idle;
    }

    /// Losses not yet released from the reservation. Only meaningful between rounds.
    pub fn unforfeited_loss(&self) -> u64 {
        let net = self.net_win(self.balance);
        if net < 0 {
            (-net) as u64
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement::settle;

    fn config() -> Config {
        Config {
            min_bet: 106,
            max_bet: 1_000,
            max_round_gain: 50_000,
            max_player_win: 10_000,
            max_win_multiple: 10,
            onboarding_fee: 0,
            min_deposit: 2,
            min_withdrawal: 1,
            max_withdrawal: 2,
            player_daily_cap: 2,
            daily_cap: 2,
            round_timeout_secs: 60,
            validator: Pubkey::new_from_array([1; 32]),
            vrf_queue: Pubkey::new_from_array([2; 32]),
            deposits_paused: false,
            bets_paused: false,
            payouts_paused: false,
        }
    }

    #[test]
    fn config_validation_refuses_settings_that_break_play() {
        assert!(config().validate().is_ok());
        for broken in [
            Config {
                // A Banker win would gain 99: no fee.
                min_bet: 105,
                ..config()
            },
            Config {
                max_bet: u64::MAX / 200,
                max_round_gain: u64::MAX,
                max_player_win: u64::MAX,
                ..config()
            },
            Config {
                min_bet: 2_000,
                ..config()
            },
            Config {
                round_timeout_secs: 0,
                ..config()
            },
            Config {
                validator: Pubkey::default(),
                ..config()
            },
            Config {
                vrf_queue: Pubkey::default(),
                ..config()
            },
            Config {
                min_withdrawal: 3,
                min_deposit: 3,
                ..config()
            },
            Config {
                min_withdrawal: 0,
                max_withdrawal: 0,
                ..config()
            },
            Config {
                player_daily_cap: 1,
                ..config()
            },
            Config {
                daily_cap: 1,
                ..config()
            },
            Config {
                min_deposit: 0,
                min_withdrawal: 0,
                ..config()
            },
            Config {
                min_deposit: 1,
                min_withdrawal: 2,
                ..config()
            },
            Config {
                max_round_gain: 99,
                ..config()
            },
            Config {
                max_player_win: 99,
                ..config()
            },
        ] {
            assert!(broken.validate().is_err(), "{broken:?}");
        }
    }

    fn account(credited: u64, max_win: u64) -> PlayerAccount {
        PlayerAccount {
            credited,
            balance: credited,
            max_win,
            ..Default::default()
        }
    }

    fn ledger(deposited: u64) -> Ledger {
        Ledger {
            player: Pubkey::default(),
            deposited,
            withdrawn_paid: 0,
            forfeited: 0,
            max_win: 0,
            window_start: 0,
            window_paid: 0,
        }
    }

    #[test]
    fn deposits_are_credited_once_even_from_a_stale_ledger() {
        let mut a = account(0, 0);
        a.sync_ledger(&ledger(500));
        a.sync_ledger(&ledger(300)); // stale copy
        a.sync_ledger(&ledger(500));
        assert_eq!((a.balance, a.credited), (500, 500));
    }

    #[test]
    fn a_raised_win_cap_is_taken_and_a_stale_copy_never_lowers_it() {
        let mut a = account(0, 1_000);
        a.sync_ledger(&Ledger {
            max_win: 3_000,
            ..ledger(0)
        });
        a.sync_ledger(&Ledger {
            max_win: 1_000,
            ..ledger(0)
        }); // stale copy
        assert_eq!(a.max_win, 3_000);
    }

    #[test]
    fn a_raise_reserves_what_it_adds_to_the_cap_within_the_free_bankroll() {
        let mut l = Ledger {
            max_win: 1_000,
            ..ledger(0)
        };
        let mut reserved = 5_000;
        l.raise_win_cap(&mut reserved, 2_000, 2_000, &config())
            .unwrap();
        assert_eq!(
            (l.max_win, reserved),
            (3_000, 7_000),
            "cap and reservation move together"
        );

        let refused = [
            (2_000, 2_001, config(), TiltError::VaultTooSmall),
            (u64::MAX, 50_001, config(), TiltError::AmountOutOfRange),
            (u64::MAX, 0, config(), TiltError::AmountOutOfRange),
            (
                u64::MAX,
                1,
                Config {
                    bets_paused: true,
                    ..config()
                },
                TiltError::Paused,
            ),
        ];
        for (free, amount, config, error) in refused {
            assert_eq!(
                l.raise_win_cap(&mut reserved, free, amount, &config),
                Err(error.into())
            );
            assert_eq!(
                (l.max_win, reserved),
                (3_000, 7_000),
                "nothing moves on a refusal"
            );
        }
    }

    #[test]
    fn raises_never_reserve_more_than_the_vault_holds() {
        let mut rng = crate::rng::Rng::from_vrf([7; 32]);
        let held = 1_000_000;
        let mut reserved = 400_000;
        let mut ledgers = [ledger(0), ledger(0), ledger(0)];
        for _ in 0..10_000 {
            let player = &mut ledgers[rng.below(3) as usize];
            let amount = rng.below(60_000);
            let before = (reserved, player.max_win);
            let free = held - reserved;
            match player.raise_win_cap(&mut reserved, free, amount, &config()) {
                Ok(()) => assert_eq!(reserved - before.0, player.max_win - before.1),
                Err(_) => assert_eq!((reserved, player.max_win), before),
            }
            assert!(reserved <= held, "the vault covers every reservation");
        }
        let caps: u64 = ledgers.iter().map(|l| l.max_win).sum();
        assert_eq!(reserved, 400_000 + caps, "every raise is reserved");
    }

    #[test]
    fn a_round_takes_the_stake_and_settlement_returns_the_payout() {
        let mut a = account(1_000, 1_000);
        a.start_round(Game::Slots, 200, 1, 200, &config(), 0)
            .unwrap();
        assert_eq!(a.balance, 800);
        a.finish_round(settle(200, 400));
        assert_eq!((a.balance, a.fees, a.rounds), (1_198, 2, 1));
        assert_eq!(a.round.status, RoundStatus::Idle);
    }

    #[test]
    fn limits_are_enforced_when_a_round_starts() {
        let mut a = account(1_000, 1_000);
        assert!(
            a.start_round(Game::Slots, 105, 1, 0, &config(), 0).is_err(),
            "below min bet"
        );
        assert!(
            a.start_round(Game::Slots, 1_001, 1, 0, &config(), 0)
                .is_err(),
            "above max bet"
        );
        assert!(
            a.start_round(Game::Slots, 106, 1, 50_001, &config(), 0)
                .is_err(),
            "round gain too high"
        );
        let paused = Config {
            bets_paused: true,
            ..config()
        };
        assert!(
            a.start_round(Game::Slots, 106, 1, 0, &paused, 0).is_err(),
            "bets paused"
        );
        a.start_round(Game::Slots, 106, 1, 0, &config(), 0).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin); // as request_draw does
        assert!(
            a.start_round(Game::Slots, 106, 1, 0, &config(), 0).is_err(),
            "round in progress"
        );
    }

    #[test]
    fn bet_limits_apply_per_hand_and_the_round_gain_to_the_total() {
        use crate::games::blackjack::{max_gain, MAX_HANDS};
        let hands = MAX_HANDS as u8;
        let mut a = account(10_000, 12_000);
        // 6 hands of 1 000 stake 6 000, above max_bet: each hand is within it.
        a.start_round(Game::Blackjack, 1_000, hands, max_gain(6_000), &config(), 0)
            .unwrap();
        assert_eq!((a.balance, a.round.stake), (4_000, 6_000));
        let mut a = account(10_000, 11_999);
        assert_eq!(
            a.start_round(Game::Blackjack, 105, hands, max_gain(630), &config(), 0),
            Err(TiltError::AmountOutOfRange.into()),
            "each hand must reach min bet"
        );
        assert_eq!(
            a.start_round(Game::Blackjack, 1_000, 0, 0, &config(), 0),
            Err(TiltError::AmountOutOfRange.into()),
            "no hand"
        );
        let low_gain = Config {
            max_round_gain: 11_999,
            ..config()
        };
        assert_eq!(
            a.start_round(Game::Blackjack, 1_000, hands, max_gain(6_000), &low_gain, 0),
            Err(TiltError::RoundGainTooHigh.into()),
            "every hand doubled and won is reserved"
        );
        assert_eq!(
            a.start_round(Game::Blackjack, 1_000, hands, max_gain(6_000), &config(), 0),
            Err(TiltError::WinCapReached.into()),
            "the 12 000 worst case exceeds the 11 999 lifetime cap"
        );
    }

    #[test]
    fn player_account_layout_is_unchanged() {
        // Delegated accounts and withdrawals deserialize this layout: never change it.
        assert_eq!(PlayerAccount::INIT_SPACE, 187);
    }

    #[test]
    fn a_huge_stake_is_out_of_range_not_a_panic() {
        use crate::games::{baccarat::BaccaratBet, blackjack, roulette::RouletteBet, slots};
        let mut a = account(1_000, 1_000);
        for max_gain in [
            blackjack::max_gain(u64::MAX),
            RouletteBet::Straight(0).max_gain(u64::MAX),
            BaccaratBet::Tie.max_gain(u64::MAX),
            slots::max_gain(u64::MAX),
        ] {
            assert_eq!(
                a.start_round(Game::Slots, u64::MAX, 1, max_gain, &config(), 0),
                Err(TiltError::AmountOutOfRange.into())
            );
        }
    }

    #[test]
    fn win_cap_counts_the_worst_case_including_a_double() {
        // Lifetime win cap 1 000: a 500 bet can win 2 x 500 when doubled, which reaches exactly the cap.
        let mut a = account(1_000, 1_000);
        a.start_round(
            Game::Blackjack,
            500,
            1,
            crate::games::blackjack::max_gain(500),
            &config(),
            0,
        )
        .unwrap();
        a.finish_round(settle(500, 1_000)); // won 500 (fee 5)
        assert!(a
            .start_round(
                Game::Blackjack,
                500,
                1,
                crate::games::blackjack::max_gain(500),
                &config(),
                0
            )
            .is_err());
    }

    /// A one-hand round of 1 000 from a 10 000 balance, as `blackjack_bet` starts it.
    fn one_hand_of_1_000(max_win: u64) -> PlayerAccount {
        let mut a = account(10_000, max_win);
        a.start_round(
            Game::Blackjack,
            1_000,
            1,
            crate::games::blackjack::max_gain(1_000),
            &config(),
            0,
        )
        .unwrap();
        a
    }

    #[test]
    fn a_split_takes_one_base_bet() {
        let mut a = one_hand_of_1_000(10_000);
        a.take_split(1_000, 2, &config()).unwrap();
        assert_eq!((a.balance, a.round.stake), (8_000, 2_000));
        let mut broke = account(1_000, 10_000);
        broke
            .start_round(Game::Blackjack, 1_000, 1, 2_000, &config(), 0)
            .unwrap();
        assert_eq!(
            broke.take_split(1_000, 2, &config()),
            Err(TiltError::InsufficientBalance.into())
        );
        assert_eq!((broke.balance, broke.round.stake), (0, 1_000));
    }

    #[test]
    fn a_split_is_refused_once_its_worst_case_passes_the_win_cap() {
        // Two hands of 1 000 doubled and won gain 4 000: exactly the cap.
        let mut a = one_hand_of_1_000(4_000);
        // A double before the split does not eat the headroom: its stake comes back too.
        a.balance -= 1_000;
        a.round.stake += 1_000;
        a.take_split(1_000, 2, &config()).unwrap();
        assert_eq!((a.balance, a.round.stake), (7_000, 3_000));
        // Worst case actually played: the second hand doubled too, both won.
        a.balance -= 1_000;
        a.round.stake += 1_000;
        a.finish_round(settle(4_000, 8_000));
        assert!(a.net_win(a.balance) <= a.max_win as i128);

        let mut a = one_hand_of_1_000(3_999);
        assert_eq!(
            a.take_split(1_000, 2, &config()),
            Err(TiltError::WinCapReached.into())
        );
        assert_eq!((a.balance, a.round.stake), (9_000, 1_000), "nothing taken");
    }

    #[test]
    fn a_split_is_refused_once_its_worst_case_passes_the_round_gain_limit() {
        let at_limit = Config {
            max_round_gain: 4_000,
            ..config()
        };
        one_hand_of_1_000(10_000)
            .take_split(1_000, 2, &at_limit)
            .unwrap();
        let below = Config {
            max_round_gain: 3_999,
            ..config()
        };
        assert_eq!(
            one_hand_of_1_000(10_000).take_split(1_000, 2, &below),
            Err(TiltError::RoundGainTooHigh.into())
        );
    }

    #[test]
    fn withdrawals_and_forfeits_do_not_change_net_win() {
        let mut a = account(1_000, 1_000);
        a.balance = 600; // lost 400
        assert_eq!(a.net_win(a.balance), -400);
        a.balance -= 100;
        a.withdrawn += 100;
        assert_eq!(a.net_win(a.balance), -400);
        assert_eq!(a.unforfeited_loss(), 400);
        a.forfeited += a.unforfeited_loss();
        assert_eq!((a.net_win(a.balance), a.unforfeited_loss()), (0, 0));
    }

    #[test]
    fn draws_that_do_not_belong_to_the_game_are_refused() {
        let mut rng = Rng::from_vrf([1; 32]);
        for (game, draw) in [
            (Game::Blackjack, Draw::Spin),
            (Game::Roulette, Draw::Deal),
            (Game::Baccarat, Draw::Hit),
            (Game::Slots, Draw::Double),
            (Game::Roulette, Draw::Split),
            (Game::Slots, Draw::Reveal),
            (Game::Blackjack, Draw::Reveal),
            // Mines draws play on the board (`consume_mines_randomness`), never here.
            (Game::Mines, Draw::Reveal),
            (Game::Mines, Draw::Spin),
        ] {
            let mut round = Round {
                game,
                stake: 100,
                ..Round::default()
            };
            let mut table = BlackjackTable::default();
            assert!(
                round.apply_draw(draw, &mut rng, Some(&mut table)).is_err(),
                "{game:?} {draw:?}"
            );
        }
    }

    #[test]
    fn blackjack_draws_play_on_the_table() {
        let mut rng = Rng::from_vrf([3; 32]);
        let mut round = Round {
            game: Game::Blackjack,
            stake: 200,
            status: RoundStatus::AwaitingDraw(Draw::Deal),
            ..Round::default()
        };
        assert_eq!(
            round.apply_draw(Draw::Deal, &mut rng, None),
            Err(TiltError::MissingTable.into())
        );
        let mut table = BlackjackTable::default();
        // Two hands until one deal leaves a hand to play.
        loop {
            table.start(100, 2);
            if round
                .apply_draw(Draw::Deal, &mut rng, Some(&mut table))
                .unwrap()
                .is_none()
            {
                break;
            }
        }
        assert_eq!(round.status, RoundStatus::PlayerTurn);
        while !table.stand() {}
        let gross = round
            .apply_draw(Draw::Dealer, &mut rng, Some(&mut table))
            .unwrap();
        assert_eq!(gross, Some(table.gross()));
        assert_eq!(
            round.blackjack,
            BlackjackHand::default(),
            "legacy field untouched"
        );
    }

    #[test]
    fn a_split_draw_plays_on_the_table() {
        use crate::games::blackjack::TableHand;
        let mut rng = Rng::from_vrf([4; 32]);
        let mut round = Round {
            game: Game::Blackjack,
            stake: 200,
            status: RoundStatus::AwaitingDraw(Draw::Split),
            ..Round::default()
        };
        assert_eq!(
            round.apply_draw(Draw::Split, &mut rng, None),
            Err(TiltError::MissingTable.into())
        );
        let pair = |card: u8| {
            let mut hand = TableHand {
                n_cards: 2,
                ..TableHand::default()
            };
            hand.cards[..2].copy_from_slice(&[card, card]);
            let mut table = BlackjackTable::default();
            table.start(100, 1);
            table.hands[0] = hand;
            table.n_dealer = 1;
            table.dealer[0] = 9;
            table
        };
        // 8 8: both hands still to play, back to the player.
        let mut table = pair(8);
        assert_eq!(
            round.apply_draw(Draw::Split, &mut rng, Some(&mut table)),
            Ok(None)
        );
        assert_eq!(round.status, RoundStatus::PlayerTurn);
        assert_eq!((table.n_hands, table.splits), (2, 1));
        // A A alone: both aces finished, the dealer plays and the round settles.
        let mut table = pair(1);
        round.status = RoundStatus::AwaitingDraw(Draw::Split);
        let gross = round
            .apply_draw(Draw::Split, &mut rng, Some(&mut table))
            .unwrap();
        assert_eq!(gross, Some(table.gross()));
    }

    #[test]
    fn every_game_settles_its_spin() {
        let mut rng = Rng::from_vrf([2; 32]);
        let mut slots = Round {
            game: Game::Slots,
            stake: 100,
            ..Round::default()
        };
        assert!(slots
            .apply_draw(Draw::Spin, &mut rng, None)
            .unwrap()
            .is_some());
        let mut roulette = Round {
            game: Game::Roulette,
            stake: 100,
            roulette: Some(RouletteSpin {
                bet: crate::games::roulette::RouletteBet::Red,
                number: 0,
            }),
            ..Round::default()
        };
        assert!(roulette
            .apply_draw(Draw::Spin, &mut rng, None)
            .unwrap()
            .is_some());
        let mut baccarat = Round {
            game: Game::Baccarat,
            stake: 100,
            baccarat: Some(BaccaratCoup::new(
                crate::games::baccarat::BaccaratBet::Banker,
            )),
            ..Round::default()
        };
        assert!(baccarat
            .apply_draw(Draw::Spin, &mut rng, None)
            .unwrap()
            .is_some());
    }
}
