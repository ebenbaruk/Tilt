//! Punto Banco baccarat, standard third-card rules, infinite deck.
//! Player pays 1:1, Banker 1:1 minus a 5% commission, Tie 8:1 (Player and Banker
//! bets push on a tie). One VRF draw deals the whole coup.

use anchor_lang::prelude::*;

use crate::rng::Rng;
use crate::settlement::mul_div;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum BaccaratBet {
    Player,
    Banker,
    Tie,
}

/// Cards are ranks 1 (ace) to 13; empty slots are 0.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub struct BaccaratCoup {
    pub bet: BaccaratBet,
    pub player: [u8; 3],
    pub banker: [u8; 3],
}

fn value(rank: u8) -> u8 {
    if rank >= 10 {
        0
    } else {
        rank
    }
}

fn points(cards: &[u8; 3]) -> u8 {
    cards.iter().map(|&c| value(c)).sum::<u8>() % 10
}

/// Banker's third-card rule, given its two-card total and the player's third card value.
fn banker_draws(banker: u8, player_third: Option<u8>) -> bool {
    match player_third {
        None => banker <= 5,
        Some(p) => match banker {
            0..=2 => true,
            3 => p != 8,
            4 => (2..=7).contains(&p),
            5 => (4..=7).contains(&p),
            6 => (6..=7).contains(&p),
            _ => false,
        },
    }
}

impl BaccaratBet {
    pub fn max_gain(self, stake: u64) -> u64 {
        match self {
            Self::Tie => stake.saturating_mul(8),
            _ => stake,
        }
    }
}

impl BaccaratCoup {
    pub fn new(bet: BaccaratBet) -> Self {
        Self {
            bet,
            player: [0; 3],
            banker: [0; 3],
        }
    }

    /// Deals in casino order: player, banker, player, banker, then third cards.
    pub fn deal(&mut self, rng: &mut Rng) {
        let mut next = || rng.card();
        self.player = [next(), 0, 0];
        self.banker = [next(), 0, 0];
        self.player[1] = next();
        self.banker[1] = next();
        self.draw_thirds(next);
    }

    fn draw_thirds(&mut self, mut next: impl FnMut() -> u8) {
        let (p, b) = (points(&self.player), points(&self.banker));
        if p >= 8 || b >= 8 {
            return; // natural
        }
        let player_third = if p <= 5 {
            self.player[2] = next();
            Some(value(self.player[2]))
        } else {
            None
        };
        if banker_draws(b, player_third) {
            self.banker[2] = next();
        }
    }

    pub fn player_points(&self) -> u8 {
        points(&self.player)
    }

    pub fn banker_points(&self) -> u8 {
        points(&self.banker)
    }

    pub fn gross(&self, stake: u64) -> u64 {
        use std::cmp::Ordering::*;
        match (self.bet, self.player_points().cmp(&self.banker_points())) {
            (BaccaratBet::Tie, Equal) => stake * 9,
            (BaccaratBet::Tie, _) => 0,
            (_, Equal) => stake,
            (BaccaratBet::Player, Greater) => stake * 2,
            (BaccaratBet::Banker, Less) => stake + mul_div(stake, 95, 100),
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exact expected return per unit for each bet, enumerating every 6-card sequence of an
    /// infinite deck. Ranks 10 to 13 all count 0, so 10 values with weights suffice.
    fn exact_rtps() -> [f64; 3] {
        const RANKS: [(u8, u128); 10] = [
            (10, 4),
            (1, 1),
            (2, 1),
            (3, 1),
            (4, 1),
            (5, 1),
            (6, 1),
            (7, 1),
            (8, 1),
            (9, 1),
        ];
        let bets = [BaccaratBet::Player, BaccaratBet::Banker, BaccaratBet::Tie];
        let stake = 1_000_000u64;
        let mut returned = [0u128; 3];
        let mut weight: u128 = 0;
        // Card order: p1, b1, p2, b2, then up to two third cards.
        for (p1, w1) in RANKS {
            for (b1, w2) in RANKS {
                for (p2, w3) in RANKS {
                    for (b2, w4) in RANKS {
                        for (c5, w5) in RANKS {
                            for (c6, w6) in RANKS {
                                let w = w1 * w2 * w3 * w4 * w5 * w6;
                                let mut coup = BaccaratCoup {
                                    bet: BaccaratBet::Player,
                                    player: [p1, p2, 0],
                                    banker: [b1, b2, 0],
                                };
                                let mut rest = [c5, c6].into_iter();
                                coup.draw_thirds(|| rest.next().unwrap());
                                for (i, bet) in bets.into_iter().enumerate() {
                                    coup.bet = bet;
                                    returned[i] += coup.gross(stake) as u128 * w;
                                }
                                weight += w;
                            }
                        }
                    }
                }
            }
        }
        returned.map(|r| r as f64 / (weight as f64 * stake as f64))
    }

    #[test]
    fn house_edges_match_published_values() {
        // Infinite-deck references: Player 1.24%, Banker 1.06%, and a tie probability of
        // about 9.54%, so Tie 8:1 returns about 9 x 9.54% = 85.9% (8 decks: 85.6%).
        let [player, banker, tie] = exact_rtps();
        assert!((player - 0.9876).abs() < 0.0005, "player RTP {player}");
        assert!((banker - 0.9894).abs() < 0.0005, "banker RTP {banker}");
        assert!((0.855..0.862).contains(&tie), "tie RTP {tie}");
    }

    #[test]
    fn naturals_stop_the_deal() {
        let mut coup = BaccaratCoup {
            bet: BaccaratBet::Player,
            player: [4, 4, 0],
            banker: [2, 3, 0],
        };
        coup.draw_thirds(|| panic!("no third card on a natural"));
        assert_eq!(coup.gross(100), 200);
    }

    #[test]
    fn banker_rule_table() {
        assert!(banker_draws(3, Some(7)));
        assert!(!banker_draws(3, Some(8)));
        assert!(banker_draws(6, Some(6)));
        assert!(!banker_draws(6, None));
        assert!(banker_draws(5, None));
    }

    #[test]
    fn ties_push_player_and_banker_bets() {
        let tie = |bet| BaccaratCoup {
            bet,
            player: [3, 4, 0],
            banker: [13, 7, 0],
        };
        assert_eq!(tie(BaccaratBet::Player).gross(100), 100);
        assert_eq!(tie(BaccaratBet::Banker).gross(100), 100);
        assert_eq!(tie(BaccaratBet::Tie).gross(100), 900);
    }

    #[test]
    fn banker_win_pays_minus_commission() {
        let coup = BaccaratCoup {
            bet: BaccaratBet::Banker,
            player: [3, 3, 13],
            banker: [9, 13, 0],
        };
        assert_eq!(coup.gross(100), 195);
    }
}
