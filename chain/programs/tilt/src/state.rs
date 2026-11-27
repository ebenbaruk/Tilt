use anchor_lang::prelude::*;

use crate::constants::{MIN_BET_FLOOR, MIN_ROUND_TIMEOUT_SECS};
use crate::errors::TiltError;
use crate::games::{
    baccarat::BaccaratCoup,
    blackjack::{BlackjackTable, MAX_CARDS},
    roulette::RouletteSpin,
    slots::SlotsSpin,
};
use crate::risk::{Pooled, RiskPool};
use crate::rng::Rng;
use crate::settlement::Settlement;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct Config {
    /// Smallest stake, at least `MIN_BET_FLOOR`. Whatever a round gains, a win pays Tilt at
    /// least `MIN_FEE` (`settle`).
    pub min_bet: u64,
    /// Largest stake of one bet, in USDC base units: a blackjack hand, a roulette chip (a
    /// `roulette_chips` spin stakes up to `MAX_CHIPS` of them), the bet of any other round.
    pub max_bet: u64,
    /// Largest gain one round may produce (caps e.g. straight-up roulette and slot jackpots).
    /// Also the most one round can take from the risk pool (`risk::required_reserve`).
    pub max_round_gain: u64,
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
    /// A draw not answered this long can be requested again by the relayer. At least
    /// `MIN_ROUND_TIMEOUT_SECS`.
    pub round_timeout_secs: i64,
    /// A round left waiting for the player this long (a blackjack hand, a Mines, Hilo or Tower
    /// board) is closed for them by the relayer: stand, or cash-out at the current value. Until
    /// then it holds its share of the risk pool and blocks `checkpoint`. At least
    /// `round_timeout_secs`.
    pub abandoned_round_secs: i64,
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
        require!(
            // Every move costs Tilt a VRF draw and a transaction: a dust stake would make
            // spamming rounds (or parking one forever) nearly free.
            self.min_bet >= MIN_BET_FLOOR
                && self.min_bet <= self.max_bet
                // Settlement multiplies stakes by up to the slots jackpot; a doubled blackjack
                // stake only returns 2x, well within this.
                && self.max_bet.checked_mul(crate::games::slots::MAX_MULTIPLE).is_some()
                // Even-money bets gain their stake: below this no bet could ever start.
                && self.max_round_gain >= self.min_bet
                && self.min_deposit >= self.min_withdrawal
                && self.min_deposit > 0
                // Otherwise every withdrawal would be held, like a silent payout pause.
                && self.min_withdrawal <= self.max_withdrawal
                && self.max_withdrawal > 0
                && self.max_withdrawal <= self.player_daily_cap
                && self.max_withdrawal <= self.daily_cap
                && self.round_timeout_secs >= MIN_ROUND_TIMEOUT_SECS
                && self.abandoned_round_secs >= self.round_timeout_secs
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
    /// What the vault may owe in the worst case: for every player, deposited - forfeited -
    /// withdrawn_paid + their secured wins, plus what is left of the risk pool's line
    /// (pool_line - pool_transferred).
    pub reserved: u64,
    pub config: Config,
    pub window_start: i64,
    pub window_paid: u64,
    /// Bankroll granted to the risk pool so far (`fund_risk_pool`), reserved; never decreases.
    pub pool_line: u64,
    /// Part of `pool_line` moved to players' secured wins (`Ledger::win_reserved`), as the
    /// rollup's `RiskPool::transferred` reports it; never decreases.
    pub pool_transferred: u64,
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
    /// House money reserved for the player's wins, moved from the risk pool's line when a
    /// withdrawal needs it; never decreases.
    pub win_reserved: u64,
    /// Part of `win_reserved` given back to the house by `checkpoint` once the player lost
    /// it again; never decreases.
    pub win_released: u64,
    pub window_start: i64,
    pub window_paid: u64,
}

impl Ledger {
    /// House money Solana holds for the player's wins.
    pub fn secured(&self) -> u64 {
        self.win_reserved - self.win_released
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
    /// The one-draw games, appended after Mines. They play on `QuickTable`
    /// (`consume_quick_randomness`), outside `apply_draw`.
    Dice,
    Limbo,
    Flip,
    Keno,
    Wheel,
    /// Play on `HiloBoard` (`consume_hilo_randomness`).
    Hilo,
    /// Plays on `TowerBoard` (`consume_tower_randomness`).
    Tower,
}

impl Game {
    /// Games whose draws `consume_randomness` plays (and `expire_round` retries); the others
    /// call back with their own account.
    pub fn draws_in_round(self) -> bool {
        matches!(
            self,
            Self::Blackjack | Self::Roulette | Self::Baccarat | Self::Slots
        )
    }

    /// The one-draw games kept on `QuickTable`.
    pub fn is_quick(self) -> bool {
        matches!(
            self,
            Self::Dice | Self::Limbo | Self::Flip | Self::Keno | Self::Wheel
        )
    }
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
    /// Hilo: the round's first card, or the card a guess waits for. Appended last. (The
    /// one-draw games use `Spin`.)
    Card,
    /// Tower: the picked tile is safe or not. Appended last.
    Climb,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum RoundStatus {
    Idle,
    /// A VRF draw was requested; its callback (`consume_randomness`, or the game's own for
    /// Mines, the one-draw games, Hilo and Tower) will continue the round.
    AwaitingDraw(Draw),
    /// Blackjack: waiting for hit, stand, double or split. Mines, Hilo, Tower: waiting for the
    /// next move or a cash-out.
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
    /// What the round puts on the risk pool until it settles.
    pub pooled: Pooled,
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
            pooled: Pooled::default(),
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

    /// A `roulette_chips` spin: its chips live on the player's `RouletteTable`, so its draw is
    /// answered by `consume_roulette_randomness` and retried by `expire_roulette_round`. A
    /// `roulette_spin` round always holds its bet in `roulette`.
    pub fn on_roulette_table(&self) -> bool {
        self.game == Game::Roulette && self.roulette.is_none()
    }
}

/// The player's balance and current round. Lives in the rollup permanently.
#[account]
#[derive(InitSpace, Default)]
pub struct PlayerAccount {
    pub player: Pubkey,
    /// Deposits already credited from the ledger; never decreases.
    pub credited: u64,
    /// Losses released from the vault reservation by `checkpoint`; never decreases.
    pub forfeited: u64,
    /// Total ever withdrawn; never decreases.
    pub withdrawn: u64,
    /// House money moved from the risk pool to Solana for this player's wins (`secure_wins`,
    /// before a withdrawal); never decreases. Solana mirrors it in `Ledger::win_reserved`.
    pub win_reserved: u64,
    /// Part of `win_reserved` given back to the house once lost again (`checkpoint`); never
    /// decreases.
    pub win_released: u64,
    /// Net wins beyond the secured ones: the risk pool pays them until a withdrawal secures
    /// them (its share of `RiskPool::uncovered`).
    pub uncovered: u64,
    pub balance: u64,
    pub rounds: u32,
    /// Tilt's 1% fees taken from this player's winning rounds.
    pub fees: u64,
    pub round: Round,
}

/// What a round answers to beyond the player: the limits, and the risk pool with the bankroll
/// Solana granted it.
pub struct Bankroll<'a> {
    pub config: &'a Config,
    pub pool: &'a mut RiskPool,
    /// `Vault::pool_line` as the rollup sees it: a stale copy only lags a raise.
    pub line: u64,
}

impl PlayerAccount {
    /// Takes the deposits Solana recorded since the last move, credited at most once: a stale
    /// ledger copy can never take one back.
    pub fn sync_ledger(&mut self, ledger: &Ledger) {
        if ledger.deposited > self.credited {
            self.balance += ledger.deposited - self.credited;
            self.credited = ledger.deposited;
        }
    }

    /// Net win so far if the balance were `balance`; losses already forfeited are not counted.
    pub fn net_win(&self, balance: u64) -> i128 {
        balance as i128 + self.withdrawn as i128 - (self.credited as i128 - self.forfeited as i128)
    }

    /// House money Solana holds for this player's wins.
    pub fn secured(&self) -> u64 {
        self.win_reserved - self.win_released
    }

    /// Net wins at `balance` beyond the secured ones.
    fn uncovered_at(&self, balance: u64) -> u64 {
        let beyond = self.net_win(balance) - self.secured() as i128;
        u64::try_from(beyond.max(0)).expect("net win exceeds u64")
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
        bank: &mut Bankroll,
        now: i64,
    ) -> Result<()> {
        self.check_can_start(bank.config)?;
        require!(
            bet >= bank.config.min_bet && bet <= bank.config.max_bet && bets > 0,
            TiltError::AmountOutOfRange
        );
        let stake = bet
            .checked_mul(bets.into())
            .ok_or(TiltError::AmountOutOfRange)?;
        self.take_stake(game, stake, max_gain, bank, now)
    }

    /// Like `start_round` for bets of their own sizes (roulette chips): bet limits apply to
    /// each of `bets`, at least one, and the stake is their total.
    pub fn start_round_of(
        &mut self,
        game: Game,
        bets: impl IntoIterator<Item = u64>,
        max_gain: u64,
        bank: &mut Bankroll,
        now: i64,
    ) -> Result<()> {
        self.check_can_start(bank.config)?;
        let mut stake: Option<u64> = None;
        for bet in bets {
            require!(
                bet >= bank.config.min_bet && bet <= bank.config.max_bet,
                TiltError::AmountOutOfRange
            );
            stake = Some(
                stake
                    .unwrap_or(0)
                    .checked_add(bet)
                    .ok_or(TiltError::AmountOutOfRange)?,
            );
        }
        let stake = stake.ok_or(TiltError::AmountOutOfRange)?;
        self.take_stake(game, stake, max_gain, bank, now)
    }

    fn check_can_start(&self, config: &Config) -> Result<()> {
        require!(!config.bets_paused, TiltError::Paused);
        require!(
            self.round.status == RoundStatus::Idle,
            TiltError::RoundInProgress
        );
        Ok(())
    }

    /// Debits `stake` for a new round of `game` whose worst case gains `max_gain`, once the
    /// round limit, the balance and the risk pool allow it.
    fn take_stake(
        &mut self,
        game: Game,
        stake: u64,
        max_gain: u64,
        bank: &mut Bankroll,
        now: i64,
    ) -> Result<()> {
        require!(
            max_gain <= bank.config.max_round_gain,
            TiltError::RoundGainTooHigh
        );
        require!(self.balance >= stake, TiltError::InsufficientBalance);
        let pooled = self.pool_share(self.balance, max_gain, stake, Pooled::default(), bank)?;
        self.balance -= stake;
        self.round = Round {
            game,
            stake,
            last_action: now,
            request_id: self.round.request_id,
            pooled,
            ..Round::default()
        };
        Ok(())
    }

    /// Puts the round on the risk pool in place of its `old` share: what its worst case,
    /// `max_gain` above `start_balance`, could add to the player's wins beyond what is
    /// secured or already uncovered. A round the secured wins fully cover puts nothing.
    fn pool_share(
        &self,
        start_balance: u64,
        max_gain: u64,
        stake: u64,
        old: Pooled,
        bank: &mut Bankroll,
    ) -> Result<Pooled> {
        let best = start_balance
            .checked_add(max_gain)
            .ok_or(TiltError::AmountOutOfRange)?;
        let gain = self.uncovered_at(best) - self.uncovered_at(start_balance);
        let share = if gain == 0 {
            Pooled::default()
        } else {
            Pooled { gain, stake }
        };
        bank.pool
            .reprice(old, share, bank.line, bank.config.max_round_gain)?;
        Ok(share)
    }

    /// Takes one more blackjack base bet `bet` mid-round (a split) after re-checking the
    /// round like `start_round` does, now with `hands` hands of `bet`: the worst case
    /// (every hand doubled and won) must stay within the round gain limit and the risk pool.
    /// Nothing is held ahead for splits, so a split the limits cannot cover is refused.
    pub fn take_split(&mut self, bet: u64, hands: u8, bank: &mut Bankroll) -> Result<()> {
        let max_gain = crate::games::blackjack::max_gain(bet.saturating_mul(hands.into()));
        require!(
            max_gain <= bank.config.max_round_gain,
            TiltError::RoundGainTooHigh
        );
        require!(self.balance >= bet, TiltError::InsufficientBalance);
        // The balance the round started from: what it has staked so far comes back to it.
        let start_balance = self.balance + self.round.stake;
        let stake = self.round.stake + bet;
        self.round.pooled =
            self.pool_share(start_balance, max_gain, stake, self.round.pooled, bank)?;
        self.balance -= bet;
        self.round.stake = stake;
        Ok(())
    }

    /// Doubles a blackjack hand: `extra` more stake. The round's worst case already counted
    /// every hand doubled, so only its stake on the risk pool grows.
    pub fn take_double(&mut self, extra: u64, bank: &mut Bankroll) -> Result<()> {
        require!(self.balance >= extra, TiltError::InsufficientBalance);
        let old = self.round.pooled;
        if old.gain > 0 {
            let new = Pooled {
                gain: old.gain,
                stake: old.stake + extra,
            };
            bank.pool
                .reprice(old, new, bank.line, bank.config.max_round_gain)?;
            self.round.pooled = new;
        }
        self.balance -= extra;
        self.round.stake += extra;
        Ok(())
    }

    /// Pays the round out, takes its share off the risk pool and updates what the pool now
    /// pays of the player's wins.
    pub fn finish_round(&mut self, settlement: Settlement, pool: &mut RiskPool) {
        self.balance += settlement.payout;
        self.fees += settlement.fee;
        self.rounds += 1;
        self.round.payout = settlement.payout;
        self.round.fee = settlement.fee;
        self.round.status = RoundStatus::Idle;
        pool.close(self.round.pooled);
        self.round.pooled = Pooled::default();
        let uncovered = self.uncovered_at(self.balance);
        pool.recover(self.uncovered, uncovered);
        self.uncovered = uncovered;
    }

    /// After a withdrawal: moves from the risk pool to Solana the part of the player's wins
    /// the withdrawn total takes beyond their own money, which Solana then reserves from the
    /// pool's line (`apply_secured_wins`). Refused while that line, as the rollup sees it,
    /// cannot take it: the relay grants the pool more and the withdrawal is sent again.
    pub fn secure_withdrawn_wins(&mut self, pool: &mut RiskPool, line: u64) -> Result<()> {
        let needed = self.withdrawn as i128
            - (self.credited as i128 - self.forfeited as i128)
            - self.secured() as i128;
        let amount = u64::try_from(needed.max(0)).expect("withdrawn total exceeds u64");
        // The balance came from those wins: they are uncovered or already secured.
        require!(amount <= self.uncovered, TiltError::FraudSuspected);
        require!(
            pool.transferred as u128 + amount as u128 <= line as u128,
            TiltError::RiskPoolFull
        );
        pool.secure(amount);
        self.win_reserved += amount;
        self.uncovered -= amount;
        Ok(())
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

    /// Secured wins the player has lost again since: the house can take them back. Only
    /// meaningful between rounds, after the losses are forfeited.
    pub fn unneeded_secured_wins(&self) -> u64 {
        let net = u64::try_from(self.net_win(self.balance).max(0)).expect("net win exceeds u64");
        self.secured().saturating_sub(net)
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
            onboarding_fee: 0,
            min_deposit: 2,
            min_withdrawal: 1,
            max_withdrawal: 2,
            player_daily_cap: 2,
            daily_cap: 2,
            round_timeout_secs: MIN_ROUND_TIMEOUT_SECS,
            abandoned_round_secs: 21_600,
            validator: Pubkey::new_from_array([1; 32]),
            vrf_queue: Pubkey::new_from_array([2; 32]),
            deposits_paused: false,
            bets_paused: false,
            payouts_paused: false,
        }
    }

    /// `config()` scaled up to stakes `Config::validate` accepts.
    fn valid_config() -> Config {
        Config {
            min_bet: MIN_BET_FLOOR,
            max_bet: 10 * MIN_BET_FLOOR,
            max_round_gain: 500 * MIN_BET_FLOOR,
            ..config()
        }
    }

    #[test]
    fn config_validation_refuses_settings_that_break_play() {
        let valid = valid_config();
        assert!(valid.validate().is_ok());
        for broken in [
            Config {
                min_bet: 0,
                ..valid_config()
            },
            Config {
                min_bet: MIN_BET_FLOOR - 1,
                ..valid_config()
            },
            Config {
                max_bet: u64::MAX / 200,
                max_round_gain: u64::MAX,
                ..valid_config()
            },
            Config {
                min_bet: valid.max_bet + 1,
                ..valid_config()
            },
            Config {
                round_timeout_secs: 0,
                ..valid_config()
            },
            Config {
                // A retry could land while the first request can still be answered.
                round_timeout_secs: MIN_ROUND_TIMEOUT_SECS - 1,
                ..valid_config()
            },
            Config {
                abandoned_round_secs: MIN_ROUND_TIMEOUT_SECS - 1,
                ..valid_config()
            },
            Config {
                validator: Pubkey::default(),
                ..valid_config()
            },
            Config {
                vrf_queue: Pubkey::default(),
                ..valid_config()
            },
            Config {
                min_withdrawal: 3,
                min_deposit: 3,
                ..valid_config()
            },
            Config {
                min_withdrawal: 0,
                max_withdrawal: 0,
                ..valid_config()
            },
            Config {
                player_daily_cap: 1,
                ..valid_config()
            },
            Config {
                daily_cap: 1,
                ..valid_config()
            },
            Config {
                min_deposit: 0,
                min_withdrawal: 0,
                ..valid_config()
            },
            Config {
                min_deposit: 1,
                min_withdrawal: 2,
                ..valid_config()
            },
            Config {
                max_round_gain: MIN_BET_FLOOR - 1,
                ..valid_config()
            },
        ] {
            assert!(broken.validate().is_err(), "{broken:?}");
        }
    }

    fn account(credited: u64) -> PlayerAccount {
        PlayerAccount {
            credited,
            balance: credited,
            ..Default::default()
        }
    }

    fn ledger(deposited: u64) -> Ledger {
        Ledger {
            player: Pubkey::default(),
            deposited,
            withdrawn_paid: 0,
            forfeited: 0,
            win_reserved: 0,
            win_released: 0,
            window_start: 0,
            window_paid: 0,
        }
    }

    /// `config` with a risk pool that can hold `line`.
    fn bank<'a>(config: &'a Config, pool: &'a mut RiskPool, line: u64) -> Bankroll<'a> {
        Bankroll { config, pool, line }
    }

    #[test]
    fn deposits_are_credited_once_even_from_a_stale_ledger() {
        let mut a = account(0);
        a.sync_ledger(&ledger(500));
        a.sync_ledger(&ledger(300)); // stale copy
        a.sync_ledger(&ledger(500));
        assert_eq!((a.balance, a.credited), (500, 500));
    }

    #[test]
    fn a_round_puts_on_the_pool_only_what_could_take_wins_past_the_secured_ones() {
        let c = config();
        // Fresh account: the whole worst case.
        let mut pool = RiskPool::default();
        let mut a = account(1_000);
        a.start_round(
            Game::Slots,
            200,
            1,
            500,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        assert_eq!(
            a.round.pooled,
            Pooled {
                gain: 500,
                stake: 200
            }
        );
        // 400 lost and not yet forfeited: the deposit still covers the first 400 of a win.
        let mut pool = RiskPool::default();
        let mut a = account(1_000);
        a.balance = 600;
        a.start_round(
            Game::Slots,
            200,
            1,
            500,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        assert_eq!(a.round.pooled.gain, 100);
        // 300 secured but lost again since: they cover the first 300 of a win.
        let mut pool = RiskPool::default();
        let mut a = PlayerAccount {
            win_reserved: 300,
            ..account(1_000)
        };
        a.start_round(
            Game::Slots,
            200,
            1,
            500,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        assert_eq!(a.round.pooled.gain, 200);
        // Fully covered: nothing at all on the pool.
        let mut pool = RiskPool::default();
        let mut a = PlayerAccount {
            win_reserved: 500,
            ..account(1_000)
        };
        a.start_round(Game::Slots, 200, 1, 500, &mut bank(&c, &mut pool, 0), 0)
            .unwrap();
        assert_eq!((a.round.pooled, pool.stakes), (Pooled::default(), 0));
    }

    #[test]
    fn settling_frees_the_round_and_leaves_its_win_on_the_pool_until_secured() {
        let c = config();
        let mut pool = RiskPool::default();
        let mut a = account(1_000);
        a.start_round(
            Game::Slots,
            200,
            1,
            500,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        assert_eq!((pool.gains, pool.stakes), (500, 200));
        a.finish_round(settle(200, 400), &mut pool); // won 200, fee 2
        assert_eq!((pool.gains, pool.stakes, pool.exposure), (0, 0, 0));
        assert_eq!((a.uncovered, pool.uncovered), (198, 198));
        // A loss gives the pool its part back.
        a.start_round(
            Game::Slots,
            200,
            1,
            500,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        a.finish_round(settle(200, 0), &mut pool);
        assert_eq!((a.uncovered, pool.uncovered), (0, 0));
    }

    #[test]
    fn the_pool_always_holds_exactly_what_open_rounds_and_uncovered_wins_put_on_it() {
        let c = config();
        let mut rng = crate::rng::Rng::from_vrf([7; 32]);
        let mut pool = RiskPool::default();
        let mut players = [account(10_000), account(10_000), account(10_000)];
        for _ in 0..10_000 {
            let a = &mut players[rng.below(3) as usize];
            if a.round.status == RoundStatus::Idle {
                let bet = 106 + rng.below(895);
                let max_gain = bet * (1 + rng.below(40));
                let mut b = bank(&c, &mut pool, 200_000);
                if a.start_round(Game::Slots, bet, 1, max_gain, &mut b, 0)
                    .is_ok()
                {
                    a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
                }
            } else {
                let gross = if rng.below(4) == 0 {
                    a.round.stake + a.round.pooled.gain.max(1) / 2
                } else {
                    0
                };
                a.finish_round(settle(a.round.stake, gross), &mut pool);
            }
            if rng.below(50) == 0 && a.round.status == RoundStatus::Idle && a.balance > 0 {
                let amount = 1 + rng.below(a.balance);
                a.balance -= amount;
                a.withdrawn += amount;
                // A refusal leaves the withdrawal unsent: put it back.
                if a.secure_withdrawn_wins(&mut pool, 200_000).is_err() {
                    a.balance += amount;
                    a.withdrawn -= amount;
                }
            }
            let open = players.iter().map(|p| p.round.pooled);
            assert_eq!(pool.gains, open.clone().map(|p| p.gain as u128).sum());
            assert_eq!(pool.stakes, open.map(|p| p.stake as u128).sum());
            assert_eq!(
                pool.uncovered,
                players.iter().map(|p| p.uncovered).sum::<u64>()
            );
            for p in &players {
                if p.round.status == RoundStatus::Idle {
                    assert_eq!(p.uncovered, p.uncovered_at(p.balance));
                }
            }
        }
    }

    #[test]
    fn a_withdrawal_secures_only_the_wins_it_takes() {
        let mut pool = RiskPool {
            uncovered: 500,
            ..RiskPool::default()
        };
        // Deposited 1 000, now 1 500: 500 uncovered wins.
        let mut a = PlayerAccount {
            uncovered: 500,
            balance: 1_500,
            ..account(1_000)
        };
        // Its own money first: nothing secured.
        a.balance -= 1_000;
        a.withdrawn += 1_000;
        a.secure_withdrawn_wins(&mut pool, 0).unwrap();
        assert_eq!((a.win_reserved, pool.transferred), (0, 0));
        // Then 300 of the wins: refused while the line cannot take them.
        a.balance -= 300;
        a.withdrawn += 300;
        assert_eq!(
            a.secure_withdrawn_wins(&mut pool, 299),
            Err(TiltError::RiskPoolFull.into())
        );
        a.secure_withdrawn_wins(&mut pool, 300).unwrap();
        assert_eq!((a.win_reserved, a.uncovered), (300, 200));
        assert_eq!((pool.transferred, pool.uncovered), (300, 200));
    }

    #[test]
    fn secured_wins_lost_again_are_the_houses_once_losses_are_forfeited() {
        let a = PlayerAccount {
            win_reserved: 500,
            win_released: 100,
            ..account(1_000)
        };
        // Net 0: the 400 still secured are not needed.
        assert_eq!(a.unneeded_secured_wins(), 400);
        let winning = PlayerAccount {
            balance: 1_250,
            ..a.clone()
        };
        assert_eq!(winning.unneeded_secured_wins(), 150);
    }

    #[test]
    fn a_round_takes_the_stake_and_settlement_returns_the_payout() {
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(1_000);
        a.start_round(
            Game::Slots,
            200,
            1,
            200,
            &mut bank(&c, &mut pool, u64::MAX),
            0,
        )
        .unwrap();
        assert_eq!(a.balance, 800);
        a.finish_round(settle(200, 400), &mut pool);
        assert_eq!((a.balance, a.fees, a.rounds), (1_198, 2, 1));
        assert_eq!(a.round.status, RoundStatus::Idle);
    }

    #[test]
    fn limits_are_enforced_when_a_round_starts() {
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(1_000);
        let mut start = |a: &mut PlayerAccount, bet, max_gain, config: &Config| {
            a.start_round(
                Game::Slots,
                bet,
                1,
                max_gain,
                &mut bank(config, &mut pool, u64::MAX),
                0,
            )
        };
        assert!(start(&mut a, 105, 0, &c).is_err(), "below min bet");
        assert!(start(&mut a, 1_001, 0, &c).is_err(), "above max bet");
        assert!(
            start(&mut a, 106, 50_001, &c).is_err(),
            "round gain too high"
        );
        let paused = Config {
            bets_paused: true,
            ..config()
        };
        assert!(start(&mut a, 106, 0, &paused).is_err(), "bets paused");
        start(&mut a, 106, 0, &c).unwrap();
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin); // as request_draw does
        assert!(start(&mut a, 106, 0, &c).is_err(), "round in progress");
    }

    #[test]
    fn bet_limits_apply_per_hand_and_the_round_gain_to_the_total() {
        use crate::games::blackjack::{max_gain, MAX_HANDS};
        let hands = MAX_HANDS as u8;
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(10_000);
        // 6 hands of 1 000 stake 6 000, above max_bet: each hand is within it.
        a.start_round(
            Game::Blackjack,
            1_000,
            hands,
            max_gain(6_000),
            &mut bank(&c, &mut pool, 12_000),
            0,
        )
        .unwrap();
        assert_eq!((a.balance, a.round.stake), (4_000, 6_000));
        let mut a = account(10_000);
        let mut pool = RiskPool::default();
        assert_eq!(
            a.start_round(
                Game::Blackjack,
                105,
                hands,
                max_gain(630),
                &mut bank(&c, &mut pool, u64::MAX),
                0
            ),
            Err(TiltError::AmountOutOfRange.into()),
            "each hand must reach min bet"
        );
        assert_eq!(
            a.start_round(
                Game::Blackjack,
                1_000,
                0,
                0,
                &mut bank(&c, &mut pool, u64::MAX),
                0
            ),
            Err(TiltError::AmountOutOfRange.into()),
            "no hand"
        );
        let low_gain = Config {
            max_round_gain: 11_999,
            ..config()
        };
        assert_eq!(
            a.start_round(
                Game::Blackjack,
                1_000,
                hands,
                max_gain(6_000),
                &mut bank(&low_gain, &mut pool, u64::MAX),
                0
            ),
            Err(TiltError::RoundGainTooHigh.into()),
            "every hand doubled and won is counted"
        );
        assert_eq!(
            a.start_round(
                Game::Blackjack,
                1_000,
                hands,
                max_gain(6_000),
                &mut bank(&c, &mut pool, 11_999),
                0
            ),
            Err(TiltError::RiskPoolFull.into()),
            "the 12 000 worst case exceeds an 11 999 line"
        );
        assert_eq!(
            (pool.gains, pool.stakes),
            (0, 0),
            "a refused round holds nothing"
        );
    }

    #[test]
    fn player_account_size_is_pinned() {
        // Delegated accounts cannot be resized: a change needs fresh accounts.
        assert_eq!(PlayerAccount::INIT_SPACE, 219);
    }

    #[test]
    fn a_huge_stake_is_out_of_range_not_a_panic() {
        use crate::games::{baccarat::BaccaratBet, blackjack, roulette::RouletteBet, slots};
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(1_000);
        for max_gain in [
            blackjack::max_gain(u64::MAX),
            RouletteBet::Straight(0).max_gain(u64::MAX),
            BaccaratBet::Tie.max_gain(u64::MAX),
            slots::max_gain(u64::MAX),
        ] {
            assert_eq!(
                a.start_round(
                    Game::Slots,
                    u64::MAX,
                    1,
                    max_gain,
                    &mut bank(&c, &mut pool, u64::MAX),
                    0
                ),
                Err(TiltError::AmountOutOfRange.into())
            );
        }
    }

    #[test]
    fn uncovered_wins_and_open_rounds_share_the_line() {
        // Line 1 000: a 500 bet can win 2 x 500 when doubled, exactly the line.
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(1_000);
        let worst = crate::games::blackjack::max_gain(500);
        a.start_round(
            Game::Blackjack,
            500,
            1,
            worst,
            &mut bank(&c, &mut pool, 1_000),
            0,
        )
        .unwrap();
        a.finish_round(settle(500, 1_000), &mut pool); // won 500 (fee 5): 495 uncovered
        assert_eq!(
            a.start_round(
                Game::Blackjack,
                500,
                1,
                worst,
                &mut bank(&c, &mut pool, 1_000),
                0
            ),
            Err(TiltError::RiskPoolFull.into())
        );
        a.start_round(
            Game::Blackjack,
            500,
            1,
            worst,
            &mut bank(&c, &mut pool, 1_495),
            0,
        )
        .unwrap();
    }

    /// A one-hand round of 1 000 from a 10 000 balance, as `blackjack_bet` starts it.
    fn one_hand_of_1_000(pool: &mut RiskPool) -> PlayerAccount {
        let mut a = account(10_000);
        a.start_round(
            Game::Blackjack,
            1_000,
            1,
            crate::games::blackjack::max_gain(1_000),
            &mut bank(&config(), pool, u64::MAX),
            0,
        )
        .unwrap();
        a
    }

    #[test]
    fn a_split_takes_one_base_bet() {
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = one_hand_of_1_000(&mut pool);
        a.take_split(1_000, 2, &mut bank(&c, &mut pool, u64::MAX))
            .unwrap();
        assert_eq!((a.balance, a.round.stake), (8_000, 2_000));
        let mut broke = account(1_000);
        broke
            .start_round(
                Game::Blackjack,
                1_000,
                1,
                2_000,
                &mut bank(&c, &mut pool, u64::MAX),
                0,
            )
            .unwrap();
        assert_eq!(
            broke.take_split(1_000, 2, &mut bank(&c, &mut pool, u64::MAX)),
            Err(TiltError::InsufficientBalance.into())
        );
        assert_eq!((broke.balance, broke.round.stake), (0, 1_000));
    }

    #[test]
    fn a_split_replaces_the_rounds_share_and_is_refused_past_the_line() {
        // Two hands of 1 000 doubled and won gain 4 000: exactly the line.
        let c = config();
        let mut pool = RiskPool::default();
        let mut a = one_hand_of_1_000(&mut pool);
        // A double before the split does not use up the line: its stake comes back too.
        a.take_double(1_000, &mut bank(&c, &mut pool, 4_000))
            .unwrap();
        a.take_split(1_000, 2, &mut bank(&c, &mut pool, 4_000))
            .unwrap();
        assert_eq!((a.balance, a.round.stake), (7_000, 3_000));
        assert_eq!(
            a.round.pooled,
            Pooled {
                gain: 4_000,
                stake: 3_000
            }
        );
        assert_eq!(
            (pool.gains, pool.stakes),
            (4_000, 3_000),
            "one share, replaced"
        );

        let mut pool = RiskPool::default();
        let mut a = one_hand_of_1_000(&mut pool);
        assert_eq!(
            a.take_split(1_000, 2, &mut bank(&c, &mut pool, 3_999)),
            Err(TiltError::RiskPoolFull.into())
        );
        assert_eq!((a.balance, a.round.stake), (9_000, 1_000), "nothing taken");
    }

    #[test]
    fn a_split_is_refused_once_its_worst_case_passes_the_round_gain_limit() {
        let at_limit = Config {
            max_round_gain: 4_000,
            ..config()
        };
        let mut pool = RiskPool::default();
        one_hand_of_1_000(&mut pool)
            .take_split(1_000, 2, &mut bank(&at_limit, &mut pool, u64::MAX))
            .unwrap();
        let below = Config {
            max_round_gain: 3_999,
            ..config()
        };
        let mut pool = RiskPool::default();
        assert_eq!(
            one_hand_of_1_000(&mut pool).take_split(
                1_000,
                2,
                &mut bank(&below, &mut pool, u64::MAX)
            ),
            Err(TiltError::RoundGainTooHigh.into())
        );
    }

    #[test]
    fn withdrawals_and_forfeits_do_not_change_net_win() {
        let mut a = account(1_000);
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
    fn each_game_plays_its_draws_on_exactly_one_callback() {
        let classic = [Game::Blackjack, Game::Roulette, Game::Baccarat, Game::Slots];
        let quick = [Game::Dice, Game::Limbo, Game::Flip, Game::Keno, Game::Wheel];
        let boards = [Game::Mines, Game::Hilo, Game::Tower];
        assert!(classic.iter().all(|g| g.draws_in_round() && !g.is_quick()));
        assert!(quick.iter().all(|g| g.is_quick() && !g.draws_in_round()));
        assert!(boards.iter().all(|g| !g.is_quick() && !g.draws_in_round()));
    }

    #[test]
    fn only_a_chips_spin_plays_on_the_roulette_table() {
        let chips = Round {
            game: Game::Roulette,
            ..Round::default()
        };
        assert!(chips.on_roulette_table());
        let single = Round {
            roulette: Some(RouletteSpin {
                bet: crate::games::roulette::RouletteBet::Red,
                number: 0,
            }),
            ..chips.clone()
        };
        assert!(!single.on_roulette_table());
        for game in [Game::Blackjack, Game::Baccarat, Game::Slots, Game::Dice] {
            assert!(!Round {
                game,
                ..Round::default()
            }
            .on_roulette_table());
        }
    }

    #[test]
    fn bets_of_their_own_sizes_are_each_limited_and_staked_together() {
        let (c, mut pool) = (config(), RiskPool::default());
        let mut a = account(10_000);
        let mut start = |a: &mut PlayerAccount, bets: &[u64], max_gain, now| {
            a.start_round_of(
                Game::Roulette,
                bets.iter().copied(),
                max_gain,
                &mut bank(&c, &mut pool, u64::MAX),
                now,
            )
        };
        for bets in [vec![], vec![106, 1_001], vec![105]] {
            assert_eq!(
                start(&mut a, &bets, 0, 0),
                Err(TiltError::AmountOutOfRange.into()),
                "{bets:?}"
            );
        }
        assert_eq!(
            start(&mut a, &[1_000, 106], 50_001, 0),
            Err(TiltError::RoundGainTooHigh.into())
        );
        assert_eq!(a.balance, 10_000);
        start(&mut a, &[1_000, 106, 500], 3_000, 7).unwrap();
        assert_eq!((a.balance, a.round.stake), (10_000 - 1_606, 1_606));
        assert_eq!((a.round.game, a.round.last_action), (Game::Roulette, 7));
        a.round.status = RoundStatus::AwaitingDraw(Draw::Spin);
        assert_eq!(
            start(&mut a, &[106], 0, 8),
            Err(TiltError::RoundInProgress.into())
        );
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
            (Game::Slots, Draw::Card),
            (Game::Blackjack, Draw::Climb),
            // The one-draw games, Hilo and Tower play on their own accounts too.
            (Game::Dice, Draw::Spin),
            (Game::Limbo, Draw::Spin),
            (Game::Flip, Draw::Spin),
            (Game::Keno, Draw::Spin),
            (Game::Wheel, Draw::Spin),
            (Game::Hilo, Draw::Card),
            (Game::Tower, Draw::Climb),
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
