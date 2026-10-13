use anchor_lang::prelude::*;

use crate::errors::TiltError;
use crate::games::{
    baccarat::BaccaratCoup, blackjack::BlackjackHand, roulette::RouletteSpin, slots::SlotsSpin,
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
    pub max_win: u64,
    pub window_start: i64,
    pub window_paid: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum Game {
    Blackjack,
    Roulette,
    Baccarat,
    Slots,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum Draw {
    Deal,
    Hit,
    Double,
    Dealer,
    Spin,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum RoundStatus {
    Idle,
    /// A VRF draw was requested; `consume_randomness` will continue the round.
    AwaitingDraw(Draw),
    /// Blackjack only: waiting for hit, stand or double.
    PlayerTurn,
}

/// The current or last round. Lives in the player account, so an unfinished round
/// survives disconnections and can be resumed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct Round {
    pub game: Game,
    pub status: RoundStatus,
    /// Total stake, doubled blackjack included.
    pub stake: u64,
    pub last_action: i64,
    /// Id of the VRF request the round is waiting for; any other callback is refused.
    pub request_id: u64,
    pub payout: u64,
    pub fee: u64,
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
    /// Plays a VRF draw. Returns the gross return once the round is over, or `None` when a
    /// blackjack hand goes back to the player.
    pub fn apply_draw(&mut self, draw: Draw, rng: &mut Rng) -> Result<Option<u64>> {
        let stake = self.stake;
        let gross = match (self.game, draw) {
            (Game::Blackjack, Draw::Deal | Draw::Hit) => {
                let hand = &mut self.blackjack;
                let finished = if draw == Draw::Deal {
                    hand.deal(rng)
                } else {
                    hand.hit(rng)
                };
                if !finished {
                    self.status = RoundStatus::PlayerTurn;
                    return Ok(None);
                }
                hand.gross(stake)
            }
            (Game::Blackjack, Draw::Double) => {
                self.blackjack.double(rng);
                self.blackjack.gross(stake)
            }
            (Game::Blackjack, Draw::Dealer) => {
                self.blackjack.stand(rng);
                self.blackjack.gross(stake)
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

impl PlayerAccount {
    /// Credits deposits recorded on Solana since the last credit. A stale ledger copy can
    /// never make `credited` go back, so a deposit is credited at most once.
    pub fn credit_deposits(&mut self, ledger: &Ledger) {
        if ledger.deposited > self.credited {
            self.balance += ledger.deposited - self.credited;
            self.credited = ledger.deposited;
        }
    }

    /// Net win so far if the balance were `balance`; losses already forfeited are not counted.
    pub fn net_win(&self, balance: u64) -> i128 {
        balance as i128 + self.withdrawn as i128 - (self.credited as i128 - self.forfeited as i128)
    }

    /// Takes a new round's stake after checking limits. `max_gain` is the most this round can win.
    pub fn start_round(
        &mut self,
        game: Game,
        stake: u64,
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
            stake >= config.min_bet && stake <= config.max_bet,
            TiltError::AmountOutOfRange
        );
        require!(
            max_gain <= config.max_round_gain,
            TiltError::RoundGainTooHigh
        );
        require!(self.balance >= stake, TiltError::InsufficientBalance);
        require!(
            self.net_win(self.balance + max_gain) <= self.max_win as i128,
            TiltError::WinCapReached
        );
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
        a.credit_deposits(&ledger(500));
        a.credit_deposits(&ledger(300)); // stale copy
        a.credit_deposits(&ledger(500));
        assert_eq!((a.balance, a.credited), (500, 500));
    }

    #[test]
    fn a_round_takes_the_stake_and_settlement_returns_the_payout() {
        let mut a = account(1_000, 1_000);
        a.start_round(Game::Slots, 200, 200, &config(), 0).unwrap();
        assert_eq!(a.balance, 800);
        a.finish_round(settle(200, 400));
        assert_eq!((a.balance, a.fees, a.rounds), (1_198, 2, 1));
        assert_eq!(a.round.status, RoundStatus::Idle);
    }

    #[test]
    fn limits_are_enforced_when_a_round_starts() {
        let mut a = account(1_000, 1_000);
        assert!(
            a.start_round(Game::Slots, 105, 0, &config(), 0).is_err(),
            "below min bet"
        );
        assert!(
            a.start_round(Game::Slots, 1_001, 0, &config(), 0).is_err(),
            "above max bet"
        );
        assert!(
            a.start_round(Game::Slots, 106, 50_001, &config(), 0)
                .is_err(),
            "round gain too high"
        );
        let paused = Config {
            bets_paused: true,
            ..config()
        };
        assert!(
            a.start_round(Game::Slots, 106, 0, &paused, 0).is_err(),
            "bets paused"
        );
        a.start_round(Game::Slots, 106, 0, &config(), 0).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin); // as request_draw does
        assert!(
            a.start_round(Game::Slots, 106, 0, &config(), 0).is_err(),
            "round in progress"
        );
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
                a.start_round(Game::Slots, u64::MAX, max_gain, &config(), 0),
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
                crate::games::blackjack::max_gain(500),
                &config(),
                0
            )
            .is_err());
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
        ] {
            let mut round = Round {
                game,
                stake: 100,
                ..Round::default()
            };
            assert!(
                round.apply_draw(draw, &mut rng).is_err(),
                "{game:?} {draw:?}"
            );
        }
    }

    #[test]
    fn every_game_settles_its_spin() {
        let mut rng = Rng::from_vrf([2; 32]);
        let mut slots = Round {
            game: Game::Slots,
            stake: 100,
            ..Round::default()
        };
        assert!(slots.apply_draw(Draw::Spin, &mut rng).unwrap().is_some());
        let mut roulette = Round {
            game: Game::Roulette,
            stake: 100,
            roulette: Some(RouletteSpin {
                bet: crate::games::roulette::RouletteBet::Red,
                number: 0,
            }),
            ..Round::default()
        };
        assert!(roulette.apply_draw(Draw::Spin, &mut rng).unwrap().is_some());
        let mut baccarat = Round {
            game: Game::Baccarat,
            stake: 100,
            baccarat: Some(BaccaratCoup::new(
                crate::games::baccarat::BaccaratBet::Banker,
            )),
            ..Round::default()
        };
        assert!(baccarat.apply_draw(Draw::Spin, &mut rng).unwrap().is_some());
    }
}
