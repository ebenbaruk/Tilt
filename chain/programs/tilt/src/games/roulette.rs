//! European roulette: one zero. A `roulette_spin` round carries one bet, kept in the round; a
//! `roulette_chips` round carries up to `MAX_CHIPS` chips, kept on the player's `RouletteTable`.

use anchor_lang::prelude::*;

use crate::rng::Rng;

/// Chips one `roulette_chips` spin can carry.
pub const MAX_CHIPS: usize = 20;
/// `RouletteTable::pocket` until the spin lands.
pub const NO_POCKET: u8 = 255;
const POCKETS: u8 = 37;

const RED: [u8; 18] = [
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum RouletteBet {
    /// One number, 0 to 36. Pays 35:1.
    Straight(u8),
    Red,
    Black,
    Odd,
    Even,
    /// 1 to 18.
    Low,
    /// 19 to 36.
    High,
    /// 1: 1-12, 2: 13-24, 3: 25-36. Pays 2:1.
    Dozen(u8),
    /// 1: 1, 4, 7…; 2: 2, 5, 8…; 3: 3, 6, 9…. Pays 2:1.
    Column(u8),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub struct RouletteSpin {
    pub bet: RouletteBet,
    /// 0 to 36 once spun.
    pub number: u8,
}

/// One chip of a `roulette_chips` spin: its own bet and amount.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub struct RouletteChip {
    pub bet: RouletteBet,
    pub amount: u64,
}

impl Default for RouletteChip {
    fn default() -> Self {
        Self {
            bet: RouletteBet::Straight(0),
            amount: 0,
        }
    }
}

/// The pocket a spin lands on, 0 to 36. Both kinds of round draw it this way, so /verify
/// replays them alike.
pub fn spin_pocket(rng: &mut Rng) -> u8 {
    rng.below(POCKETS.into()) as u8
}

impl RouletteBet {
    pub fn is_valid(self) -> bool {
        match self {
            Self::Straight(n) => n <= 36,
            Self::Dozen(d) | Self::Column(d) => (1..=3).contains(&d),
            _ => true,
        }
    }

    /// Stake multiple returned on a win (stake included).
    fn win_multiple(self) -> u64 {
        match self {
            Self::Straight(_) => 36,
            Self::Dozen(_) | Self::Column(_) => 3,
            _ => 2,
        }
    }

    pub fn max_gain(self, stake: u64) -> u64 {
        stake.saturating_mul(self.win_multiple() - 1)
    }

    fn wins(self, n: u8) -> bool {
        // Zero loses every bet except a straight on zero.
        match self {
            Self::Straight(x) => n == x,
            _ if n == 0 => false,
            Self::Red => RED.contains(&n),
            Self::Black => !RED.contains(&n),
            Self::Odd => n % 2 == 1,
            Self::Even => n % 2 == 0,
            Self::Low => n <= 18,
            Self::High => n >= 19,
            Self::Dozen(d) => (n - 1) / 12 + 1 == d,
            Self::Column(c) => (n - 1) % 3 + 1 == c,
        }
    }
}

impl RouletteSpin {
    pub fn spin(&mut self, rng: &mut Rng) {
        self.number = spin_pocket(rng);
    }

    pub fn gross(&self, stake: u64) -> u64 {
        if self.bet.wins(self.number) {
            stake * self.bet.win_multiple()
        } else {
            0
        }
    }
}

/// A layout the program accepts: 1 to `MAX_CHIPS` chips, each on a valid bet, no two on the
/// same bet (the client merges them). Amounts are checked by `start_round_of`.
pub fn chips_are_valid(chips: &[RouletteChip]) -> bool {
    (1..=MAX_CHIPS).contains(&chips.len())
        && chips.iter().enumerate().all(|(i, chip)| {
            chip.bet.is_valid() && chips[..i].iter().all(|other| other.bet != chip.bet)
        })
}

/// What `chips` return when the ball lands on `pocket`, stakes of the winning chips included.
fn chips_gross(chips: &[RouletteChip], pocket: u8) -> u128 {
    chips
        .iter()
        .filter(|chip| chip.bet.wins(pocket))
        .map(|chip| chip.amount as u128 * chip.bet.win_multiple() as u128)
        .sum()
}

/// Most `chips` can gain over the 37 pockets (0 when every pocket loses money). Saturates, so a
/// layout beyond any limit is refused by `start_round_of` instead of panicking.
pub fn chips_max_gain(chips: &[RouletteChip]) -> u64 {
    let total: u128 = chips.iter().map(|chip| chip.amount as u128).sum();
    let best = (0..POCKETS)
        .map(|pocket| chips_gross(chips, pocket))
        .max()
        .unwrap_or(0);
    u64::try_from(best.saturating_sub(total)).unwrap_or(u64::MAX)
}

/// The player's last `roulette_chips` spin: its chips, then the pocket once landed. Lives in
/// the rollup next to the player account.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct RouletteTable {
    pub player: Pubkey,
    /// The first `n_chips` count.
    pub chips: [RouletteChip; MAX_CHIPS],
    pub n_chips: u8,
    /// 0 to 36 once landed, `NO_POCKET` before.
    pub pocket: u8,
}

impl Default for RouletteTable {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            chips: [RouletteChip::default(); MAX_CHIPS],
            n_chips: 0,
            pocket: NO_POCKET,
        }
    }
}

impl RouletteTable {
    pub fn chips(&self) -> &[RouletteChip] {
        &self.chips[..(self.n_chips as usize).min(MAX_CHIPS)]
    }

    /// A new spin of `chips` (a layout `chips_are_valid` accepted), waiting for its pocket;
    /// keeps only the player.
    pub fn start(&mut self, chips: &[RouletteChip]) {
        let mut table = Self {
            player: self.player,
            n_chips: chips.len() as u8,
            ..Self::default()
        };
        table.chips[..chips.len()].copy_from_slice(chips);
        *self = table;
    }

    pub fn landed(&self) -> bool {
        self.pocket != NO_POCKET
    }

    /// Lands the ball and returns what the chips pay back: within the stake plus the max gain
    /// the round was started with.
    pub fn spin(&mut self, rng: &mut Rng) -> u64 {
        self.pocket = spin_pocket(rng);
        crate::games::to_u64(chips_gross(self.chips(), self.pocket))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_bets() -> Vec<RouletteBet> {
        let mut bets: Vec<_> = (0..=36).map(RouletteBet::Straight).collect();
        bets.extend([
            RouletteBet::Red,
            RouletteBet::Black,
            RouletteBet::Odd,
            RouletteBet::Even,
            RouletteBet::Low,
            RouletteBet::High,
        ]);
        bets.extend((1..=3).map(RouletteBet::Dozen));
        bets.extend((1..=3).map(RouletteBet::Column));
        bets
    }

    #[test]
    fn every_bet_returns_36_out_of_37() {
        for bet in all_bets() {
            let returned: u64 = (0..=36)
                .map(|number| RouletteSpin { bet, number }.gross(1))
                .sum();
            assert_eq!(returned, 36, "{bet:?}");
        }
    }

    #[test]
    fn zero_loses_outside_bets() {
        for bet in [
            RouletteBet::Red,
            RouletteBet::Black,
            RouletteBet::Even,
            RouletteBet::Low,
            RouletteBet::Dozen(1),
            RouletteBet::Column(3),
        ] {
            assert_eq!(RouletteSpin { bet, number: 0 }.gross(100), 0);
        }
    }

    #[test]
    fn dozens_and_columns() {
        assert_eq!(
            RouletteSpin {
                bet: RouletteBet::Dozen(2),
                number: 13
            }
            .gross(100),
            300
        );
        assert_eq!(
            RouletteSpin {
                bet: RouletteBet::Dozen(2),
                number: 25
            }
            .gross(100),
            0
        );
        assert_eq!(
            RouletteSpin {
                bet: RouletteBet::Column(1),
                number: 34
            }
            .gross(100),
            300
        );
        assert_eq!(
            RouletteSpin {
                bet: RouletteBet::Column(3),
                number: 36
            }
            .gross(100),
            300
        );
    }

    #[test]
    fn invalid_bets_are_rejected() {
        assert!(!RouletteBet::Straight(37).is_valid());
        assert!(!RouletteBet::Dozen(0).is_valid());
        assert!(!RouletteBet::Column(4).is_valid());
    }

    #[test]
    fn red_and_black_split_the_wheel() {
        assert_eq!(RED.len(), 18);
        assert_eq!((1..=36).filter(|n| !RED.contains(n)).count(), 18);
    }

    fn chip(bet: RouletteBet, amount: u64) -> RouletteChip {
        RouletteChip { bet, amount }
    }

    /// Straight 17 (100), red (200), second dozen (300): 600 staked.
    fn layout() -> [RouletteChip; 3] {
        [
            chip(RouletteBet::Straight(17), 100),
            chip(RouletteBet::Red, 200),
            chip(RouletteBet::Dozen(2), 300),
        ]
    }

    #[test]
    fn chips_pay_the_sum_of_their_winning_bets() {
        let chips = layout();
        // 17 is black, in the second dozen.
        assert_eq!(chips_gross(&chips, 17), 3_600 + 900);
        // 19 is red, in the second dozen.
        assert_eq!(chips_gross(&chips, 19), 400 + 900);
        assert_eq!(chips_gross(&chips, 1), 400);
        assert_eq!(chips_gross(&chips, 0), 0);
        for pocket in 0..POCKETS {
            let one_by_one: u64 = chips
                .iter()
                .map(|c| {
                    RouletteSpin {
                        bet: c.bet,
                        number: pocket,
                    }
                    .gross(c.amount)
                })
                .sum();
            assert_eq!(chips_gross(&chips, pocket), one_by_one as u128, "{pocket}");
        }
    }

    #[test]
    fn chips_return_36_out_of_37_of_the_stake() {
        let mut chips: Vec<_> = all_bets()
            .into_iter()
            .take(MAX_CHIPS)
            .enumerate()
            .map(|(i, bet)| chip(bet, 100 + i as u64))
            .collect();
        chips.push(chip(RouletteBet::Column(3), 7));
        let total: u128 = chips.iter().map(|c| c.amount as u128).sum();
        let returned: u128 = (0..POCKETS).map(|p| chips_gross(&chips, p)).sum();
        assert_eq!(returned, 36 * total);
    }

    #[test]
    fn the_max_gain_is_the_best_pocket_net_of_every_chip() {
        assert_eq!(chips_max_gain(&layout()), 4_500 - 600);
        assert_eq!(
            chips_max_gain(&[chip(RouletteBet::Straight(0), 100)]),
            3_500
        );
        assert_eq!(
            chips_max_gain(&[chip(RouletteBet::Dozen(1), 100)]),
            RouletteBet::Dozen(1).max_gain(100)
        );
        // Red and black of the same size never gain: the best pocket breaks even.
        let hedged = [chip(RouletteBet::Red, 100), chip(RouletteBet::Black, 100)];
        assert_eq!(chips_max_gain(&hedged), 0);
        let huge = [chip(RouletteBet::Straight(1), u64::MAX)];
        assert_eq!(
            chips_max_gain(&huge),
            u64::MAX,
            "saturates instead of panicking"
        );
    }

    #[test]
    fn a_layout_takes_1_to_20_distinct_valid_bets() {
        let bets = all_bets();
        assert!(!chips_are_valid(&[]));
        let twenty: Vec<_> = bets.iter().take(20).map(|&b| chip(b, 1)).collect();
        assert!(chips_are_valid(&twenty));
        assert!(chips_are_valid(&twenty[..1]));
        let twenty_one: Vec<_> = bets.iter().take(21).map(|&b| chip(b, 1)).collect();
        assert!(!chips_are_valid(&twenty_one));
        let duplicate = [chip(RouletteBet::Red, 1), chip(RouletteBet::Red, 2)];
        assert!(!chips_are_valid(&duplicate));
        let same_number = [
            chip(RouletteBet::Straight(5), 1),
            chip(RouletteBet::Dozen(1), 1),
            chip(RouletteBet::Straight(5), 1),
        ];
        assert!(!chips_are_valid(&same_number));
        let distinct = [
            chip(RouletteBet::Dozen(1), 1),
            chip(RouletteBet::Column(1), 1),
        ];
        assert!(chips_are_valid(&distinct), "same index, other kind");
        for invalid in [
            RouletteBet::Straight(37),
            RouletteBet::Dozen(0),
            RouletteBet::Column(4),
        ] {
            assert!(!chips_are_valid(&[
                chip(RouletteBet::Red, 1),
                chip(invalid, 1)
            ]));
        }
    }

    #[test]
    fn the_table_lands_the_pocket_like_a_single_bet_spin() {
        let mut table = RouletteTable::default();
        table.start(&layout());
        assert_eq!((table.chips(), table.landed()), (&layout()[..], false));
        let randomness = [11; 32];
        let gross = table.spin(&mut Rng::from_vrf(randomness));
        let mut single = RouletteSpin {
            bet: RouletteBet::Red,
            number: 0,
        };
        single.spin(&mut Rng::from_vrf(randomness));
        assert_eq!(table.pocket, single.number);
        assert!(table.landed());
        assert_eq!(gross as u128, chips_gross(&layout(), table.pocket));
        // A new spin keeps only the player.
        table.player = Pubkey::new_unique();
        let player = table.player;
        table.start(&[chip(RouletteBet::Odd, 5)]);
        assert_eq!(
            table,
            RouletteTable {
                player,
                chips: {
                    let mut chips = [RouletteChip::default(); MAX_CHIPS];
                    chips[0] = chip(RouletteBet::Odd, 5);
                    chips
                },
                n_chips: 1,
                pocket: NO_POCKET,
            }
        );
    }

    #[test]
    fn table_layout_is_fixed() {
        // Delegated accounts cannot be resized: changing this needs a new seed. A chip is the
        // bet (tag + byte) and its amount.
        assert_eq!(RouletteChip::INIT_SPACE, 2 + 8);
        assert_eq!(RouletteTable::INIT_SPACE, 32 + 20 * 10 + 1 + 1);
    }
}
