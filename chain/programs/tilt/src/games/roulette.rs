//! European roulette: one zero, one bet per spin.

use anchor_lang::prelude::*;

use crate::rng::Rng;

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
        self.number = rng.below(37) as u8;
    }

    pub fn gross(&self, stake: u64) -> u64 {
        if self.bet.wins(self.number) {
            stake * self.bet.win_multiple()
        } else {
            0
        }
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
}
