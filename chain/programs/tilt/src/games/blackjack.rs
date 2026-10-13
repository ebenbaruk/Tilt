//! Blackjack, European no-hole-card rules, infinite deck.
//!
//! - The dealer's second card is only drawn once the player has finished, so it
//!   never exists on-chain while the player is deciding.
//! - Dealer stands on all 17s. Blackjack pays 3:2. Double on any first two cards
//!   (one card, then the dealer plays). No split in v1 (spec D11).
//! - No hole card: a dealer blackjack beats everything but a player blackjack,
//!   including the doubled stake.

use anchor_lang::prelude::*;

use crate::rng::Rng;
use crate::settlement::mul_div;

/// Enough for any hand: the player stops at 21, the dealer at 17.
pub const MAX_CARDS: usize = 21;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace, PartialEq, Eq, Debug)]
pub struct BlackjackHand {
    pub player: [u8; MAX_CARDS],
    pub n_player: u8,
    pub dealer: [u8; MAX_CARDS],
    pub n_dealer: u8,
    pub doubled: bool,
}

/// Best total with soft aces. Cards are ranks 1 (ace) to 13.
pub fn total(cards: &[u8]) -> u8 {
    let hard: u8 = cards.iter().map(|&c| c.min(10)).sum();
    let has_ace = cards.contains(&1);
    if has_ace && hard + 10 <= 21 {
        hard + 10
    } else {
        hard
    }
}

fn is_blackjack(cards: &[u8]) -> bool {
    cards.len() == 2 && total(cards) == 21
}

/// Largest gain for a base bet, reached by doubling and winning.
pub fn max_gain(bet: u64) -> u64 {
    bet.saturating_mul(2)
}

impl BlackjackHand {
    pub fn player_cards(&self) -> &[u8] {
        &self.player[..self.n_player as usize]
    }

    pub fn dealer_cards(&self) -> &[u8] {
        &self.dealer[..self.n_dealer as usize]
    }

    pub fn player_total(&self) -> u8 {
        total(self.player_cards())
    }

    pub fn can_hit(&self) -> bool {
        self.player_total() < 21 && (self.n_player as usize) < MAX_CARDS
    }

    pub fn can_double(&self) -> bool {
        self.n_player == 2 && !self.doubled && self.player_total() < 21
    }

    fn draw_player(&mut self, rng: &mut Rng) {
        self.player[self.n_player as usize] = rng.card();
        self.n_player += 1;
    }

    fn draw_dealer(&mut self, rng: &mut Rng) {
        self.dealer[self.n_dealer as usize] = rng.card();
        self.n_dealer += 1;
    }

    fn dealer_play(&mut self, rng: &mut Rng) {
        while total(self.dealer_cards()) < 17 && (self.n_dealer as usize) < MAX_CARDS {
            self.draw_dealer(rng);
        }
    }

    /// Two cards to the player, one to the dealer. Returns true when the round is over
    /// (player blackjack: the dealer draws one card to check for a push).
    pub fn deal(&mut self, rng: &mut Rng) -> bool {
        *self = Self::default();
        self.draw_player(rng);
        self.draw_player(rng);
        self.draw_dealer(rng);
        if is_blackjack(self.player_cards()) {
            self.draw_dealer(rng);
            return true;
        }
        false
    }

    /// One card. Returns true when the round is over (bust, or 21 and the dealer played).
    pub fn hit(&mut self, rng: &mut Rng) -> bool {
        self.draw_player(rng);
        match self.player_total() {
            t if t > 21 => true,
            21 => {
                self.dealer_play(rng);
                true
            }
            _ if (self.n_player as usize) == MAX_CARDS => {
                self.dealer_play(rng);
                true
            }
            _ => false,
        }
    }

    /// Doubles the stake (the caller debits it), one card, then the dealer plays.
    pub fn double(&mut self, rng: &mut Rng) {
        self.doubled = true;
        self.draw_player(rng);
        if self.player_total() <= 21 {
            self.dealer_play(rng);
        }
    }

    pub fn stand(&mut self, rng: &mut Rng) {
        self.dealer_play(rng);
    }

    /// What the finished hand returns for `stake` (the whole stake, doubled or not).
    pub fn gross(&self, stake: u64) -> u64 {
        let (player, dealer) = (self.player_cards(), self.dealer_cards());
        let (p, d) = (total(player), total(dealer));
        let player_bj = is_blackjack(player) && !self.doubled;
        let dealer_bj = is_blackjack(dealer);
        if p > 21 {
            0
        } else if player_bj && dealer_bj {
            stake
        } else if player_bj {
            mul_div(stake, 5, 2)
        } else if dealer_bj {
            0
        } else if d > 21 || p > d {
            stake * 2
        } else if p == d {
            stake
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hand(player: &[u8], dealer: &[u8], doubled: bool) -> BlackjackHand {
        let mut h = BlackjackHand {
            doubled,
            ..Default::default()
        };
        h.player[..player.len()].copy_from_slice(player);
        h.n_player = player.len() as u8;
        h.dealer[..dealer.len()].copy_from_slice(dealer);
        h.n_dealer = dealer.len() as u8;
        h
    }

    #[test]
    fn totals_count_aces_soft_when_possible() {
        assert_eq!(total(&[1, 6]), 17);
        assert_eq!(total(&[1, 6, 10]), 17);
        assert_eq!(total(&[1, 1, 9]), 21);
        assert_eq!(total(&[13, 12]), 20);
    }

    #[test]
    fn payouts() {
        let stake = 1_000;
        assert_eq!(
            hand(&[1, 13], &[9, 8], false).gross(stake),
            2_500,
            "blackjack 3:2"
        );
        assert_eq!(
            hand(&[1, 13], &[1, 10], false).gross(stake),
            1_000,
            "blackjack vs blackjack pushes"
        );
        assert_eq!(
            hand(&[10, 9], &[1, 10], false).gross(stake),
            0,
            "dealer blackjack wins"
        );
        assert_eq!(
            hand(&[10, 9], &[10, 8], false).gross(stake),
            2_000,
            "higher total wins 1:1"
        );
        assert_eq!(
            hand(&[10, 8], &[10, 8], false).gross(stake),
            1_000,
            "equal totals push"
        );
        assert_eq!(
            hand(&[10, 6, 9], &[2], false).gross(stake),
            0,
            "bust loses even if dealer would bust"
        );
        assert_eq!(
            hand(&[10, 6], &[10, 6, 9], false).gross(stake),
            2_000,
            "dealer bust"
        );
    }

    #[test]
    fn doubled_21_is_not_a_blackjack_and_loses_to_dealer_blackjack() {
        assert_eq!(hand(&[5, 6, 10], &[9, 8], true).gross(2_000), 4_000);
        assert_eq!(hand(&[5, 6, 10], &[1, 13], true).gross(2_000), 0);
    }

    /// Deals from successive seeds until a hand where the player still has to decide.
    fn open_hand() -> (BlackjackHand, Rng) {
        for i in 0u64.. {
            let mut seed = [0u8; 32];
            seed[..8].copy_from_slice(&i.to_le_bytes());
            let mut rng = Rng::from_vrf(seed);
            let mut h = BlackjackHand::default();
            if !h.deal(&mut rng) {
                return (h, rng);
            }
        }
        unreachable!()
    }

    #[test]
    fn dealer_hole_card_is_drawn_only_after_the_player() {
        let (h, _) = open_hand();
        assert_eq!((h.n_player, h.n_dealer), (2, 1));
    }

    #[test]
    fn a_natural_draws_exactly_one_more_dealer_card() {
        let mut h = hand(&[], &[], false);
        // Seeds until the player is dealt a blackjack.
        for i in 0u64.. {
            let mut seed = [0u8; 32];
            seed[..8].copy_from_slice(&i.to_le_bytes());
            if h.deal(&mut Rng::from_vrf(seed)) {
                break;
            }
        }
        assert!(is_blackjack(h.player_cards()));
        assert_eq!(h.n_dealer, 2);
    }

    #[test]
    fn bust_on_hit_ends_without_dealer_cards() {
        let mut h = hand(&[10, 6], &[9], false);
        let mut rng = Rng::from_vrf([0; 32]);
        while !h.hit(&mut rng) {}
        if h.player_total() > 21 {
            assert_eq!(h.n_dealer, 1);
            assert_eq!(h.gross(1_000), 0);
        } else {
            assert_eq!(h.player_total(), 21);
            assert!(total(h.dealer_cards()) >= 17, "21 makes the dealer play");
        }
    }

    #[test]
    fn double_takes_exactly_one_card() {
        let (mut h, mut rng) = open_hand();
        h.double(&mut rng);
        assert_eq!(h.n_player, 3);
        assert!(h.doubled);
        if h.player_total() > 21 {
            assert_eq!(h.n_dealer, 1, "no dealer cards after a bust");
        } else {
            assert!(total(h.dealer_cards()) >= 17);
        }
    }

    #[test]
    fn dealer_stands_on_soft_17() {
        let mut h = hand(&[10, 8], &[1, 6], false);
        h.stand(&mut Rng::from_vrf([0; 32]));
        assert_eq!(h.dealer_cards(), &[1, 6]);
    }

    /// Simple basic strategy for this rule set (no split).
    fn play(h: &mut BlackjackHand, rng: &mut Rng) -> u64 {
        let stake = 1_000;
        if h.deal(rng) {
            return h.gross(stake);
        }
        let up = h.dealer[0].min(10);
        let up = if up == 1 { 11 } else { up };
        let soft = h.player_cards().contains(&1)
            && h.player_cards().iter().map(|&c| c.min(10)).sum::<u8>() + 10 <= 21;
        let t = h.player_total();
        let double =
            !soft && (((t == 10 || t == 11) && up <= 9) || (t == 9 && (3..=6).contains(&up)));
        if double {
            h.double(rng);
            return h.gross(stake * 2);
        }
        loop {
            let t = h.player_total();
            let soft = h.player_cards().contains(&1)
                && h.player_cards().iter().map(|&c| c.min(10)).sum::<u8>() + 10 <= 21;
            let stand = if soft {
                t >= 19 || (t == 18 && up <= 8)
            } else {
                t >= 17 || (t >= 13 && up <= 6) || (t == 12 && (4..=6).contains(&up))
            };
            if stand {
                h.stand(rng);
                return h.gross(stake);
            }
            if h.hit(rng) {
                return h.gross(stake);
            }
        }
    }

    #[test]
    fn house_keeps_an_edge_with_basic_strategy() {
        let (mut staked, mut returned) = (0u64, 0u64);
        for i in 0..400_000u64 {
            let mut seed = [0u8; 32];
            seed[..8].copy_from_slice(&i.to_le_bytes());
            let mut rng = Rng::from_vrf(seed);
            let mut h = BlackjackHand::default();
            let gross = play(&mut h, &mut rng);
            staked += if h.doubled { 2_000 } else { 1_000 };
            returned += gross;
        }
        let rtp = returned as f64 / staked as f64;
        // No-hole-card, S17, 3:2, no split, infinite deck, this simple strategy: 98.7% measured
        // (seeds fixed). ±0.6% is 3 standard errors; losing the double or 3:2 falls outside.
        assert!((0.981..0.993).contains(&rtp), "blackjack RTP {rtp}");
    }
}
