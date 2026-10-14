//! Blackjack, European no-hole-card rules, infinite deck, 1 to `MAX_HANDS` hands of the
//! same bet against one dealer.
//!
//! - Every hand gets two cards, the dealer one. The dealer's second card is only drawn
//!   once every hand is finished, so it never exists on-chain while the player decides.
//! - Hands are played left to right; a natural is finished at once.
//! - Dealer stands on all 17s. Blackjack pays 3:2. Double on any first two cards
//!   (one card, the hand is finished). No split (spec D11).
//! - No hole card: a dealer blackjack beats everything but a player blackjack,
//!   including a doubled stake.

use anchor_lang::prelude::*;

use crate::rng::Rng;
use crate::settlement::mul_div;

/// Enough for any hand: the player stops at 21, the dealer at 17.
pub const MAX_CARDS: usize = 21;
/// Most hands one round can play against the dealer.
pub const MAX_HANDS: usize = 6;
/// The dealer stands on any 17, soft or hard.
const DEALER_STANDS_ON: u8 = 17;
const BLACKJACK: u8 = 21;

/// Best total with soft aces. Cards are ranks 1 (ace) to 13.
pub fn total(cards: &[u8]) -> u8 {
    let hard: u8 = cards.iter().map(|&c| c.min(10)).sum();
    let has_ace = cards.contains(&1);
    if has_ace && hard + 10 <= BLACKJACK {
        hard + 10
    } else {
        hard
    }
}

fn is_blackjack(cards: &[u8]) -> bool {
    cards.len() == 2 && total(cards) == BLACKJACK
}

/// Largest gain for a round staking `total_stake` (every hand's base bet), reached by
/// doubling and winning every hand.
pub fn max_gain(total_stake: u64) -> u64 {
    total_stake.saturating_mul(2)
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, PartialEq, Eq, Debug,
)]
pub struct TableHand {
    pub cards: [u8; MAX_CARDS],
    pub n_cards: u8,
    pub doubled: bool,
}

impl TableHand {
    pub fn cards(&self) -> &[u8] {
        &self.cards[..self.n_cards as usize]
    }

    pub fn total(&self) -> u8 {
        total(self.cards())
    }

    /// Two-card 21, not from a double.
    pub fn is_natural(&self) -> bool {
        is_blackjack(self.cards()) && !self.doubled
    }

    pub fn is_bust(&self) -> bool {
        self.total() > BLACKJACK
    }

    pub fn can_hit(&self) -> bool {
        self.total() < BLACKJACK && (self.n_cards as usize) < MAX_CARDS && !self.doubled
    }

    pub fn can_double(&self) -> bool {
        self.n_cards == 2 && !self.doubled && self.total() < BLACKJACK
    }

    /// Nothing left to play: 21 or more, doubled, or out of room.
    fn is_done(&self) -> bool {
        !self.can_hit()
    }

    fn draw(&mut self, rng: &mut Rng) {
        self.cards[self.n_cards as usize] = rng.card();
        self.n_cards += 1;
    }

    /// What this finished hand returns against `dealer` for a base bet of `bet`.
    pub fn gross(&self, dealer: &[u8], bet: u64) -> u64 {
        let stake = if self.doubled { bet * 2 } else { bet };
        let (p, d) = (self.total(), total(dealer));
        let dealer_bj = is_blackjack(dealer);
        if p > BLACKJACK {
            0
        } else if self.is_natural() && dealer_bj {
            stake
        } else if self.is_natural() {
            mul_div(stake, 5, 2)
        } else if dealer_bj {
            0
        } else if d > BLACKJACK || p > d {
            stake * 2
        } else if p == d {
            stake
        } else {
            0
        }
    }
}

/// The player's blackjack round: hands and dealer. Lives in the rollup next to the player
/// account; between rounds it keeps the last round for display.
#[account]
#[derive(InitSpace, Default, Debug, PartialEq, Eq)]
pub struct BlackjackTable {
    pub player: Pubkey,
    /// Base bet of every hand (a doubled hand stakes twice this).
    pub bet: u64,
    pub hands: [TableHand; MAX_HANDS],
    pub n_hands: u8,
    /// Index of the hand to play while the round waits for the player; `n_hands` once
    /// every hand is finished.
    pub active: u8,
    pub dealer: [u8; MAX_CARDS],
    pub n_dealer: u8,
}

impl BlackjackTable {
    pub fn hands(&self) -> &[TableHand] {
        &self.hands[..self.n_hands as usize]
    }

    pub fn dealer_cards(&self) -> &[u8] {
        &self.dealer[..self.n_dealer as usize]
    }

    /// The hand waiting for the player, if any.
    pub fn active_hand(&self) -> Option<&TableHand> {
        self.hands().get(self.active as usize)
    }

    /// Clears the last round for `n_hands` hands of `bet`; cards come with `deal`.
    pub fn start(&mut self, bet: u64, n_hands: u8) {
        *self = Self {
            player: self.player,
            bet,
            n_hands,
            ..Self::default()
        };
    }

    /// Stake of the whole round, doubles included.
    pub fn stake(&self) -> u64 {
        self.hands()
            .iter()
            .map(|h| if h.doubled { self.bet * 2 } else { self.bet })
            .sum()
    }

    /// Two cards to every hand, one to the dealer. Returns true when the round is over
    /// (only naturals: the dealer has played).
    pub fn deal(&mut self, rng: &mut Rng) -> bool {
        for hand in &mut self.hands[..self.n_hands as usize] {
            hand.draw(rng);
            hand.draw(rng);
        }
        self.draw_dealer(rng);
        self.active = 0;
        self.next_hand(rng)
    }

    /// One card to the active hand. Returns true when the round is over.
    pub fn hit(&mut self, rng: &mut Rng) -> bool {
        self.hands[self.active as usize].draw(rng);
        self.next_hand(rng)
    }

    /// The active hand's stake doubles (the caller debits it), it takes exactly one card
    /// and is finished. Returns true when the round is over.
    pub fn double(&mut self, rng: &mut Rng) -> bool {
        let hand = &mut self.hands[self.active as usize];
        hand.doubled = true;
        hand.draw(rng);
        self.next_hand(rng)
    }

    /// Finishes the active hand without a card. Returns true when no hand is left to play,
    /// i.e. the dealer must now play (`play_dealer`, which needs a draw).
    pub fn stand(&mut self) -> bool {
        self.active += 1;
        self.skip_done_hands();
        self.active_hand().is_none()
    }

    /// The dealer's turn once no hand is left: draws to 17 if a hand still competes on
    /// total, else one card if a natural needs the push check, else nothing (all bust).
    pub fn play_dealer(&mut self, rng: &mut Rng) {
        let hands = self.hands();
        if hands.iter().any(|h| !h.is_bust() && !h.is_natural()) {
            while total(self.dealer_cards()) < DEALER_STANDS_ON
                && (self.n_dealer as usize) < MAX_CARDS
            {
                self.draw_dealer(rng);
            }
        } else if hands.iter().any(TableHand::is_natural) {
            self.draw_dealer(rng);
        }
    }

    /// What the finished round returns: every hand settled against the dealer.
    pub fn gross(&self) -> u64 {
        let dealer = self.dealer_cards();
        self.hands().iter().map(|h| h.gross(dealer, self.bet)).sum()
    }

    fn draw_dealer(&mut self, rng: &mut Rng) {
        self.dealer[self.n_dealer as usize] = rng.card();
        self.n_dealer += 1;
    }

    fn skip_done_hands(&mut self) {
        while self.active_hand().is_some_and(TableHand::is_done) {
            self.active += 1;
        }
    }

    /// Moves past finished hands; once none is left the dealer plays and this returns true.
    fn next_hand(&mut self, rng: &mut Rng) -> bool {
        self.skip_done_hands();
        if self.active_hand().is_some() {
            return false;
        }
        self.play_dealer(rng);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BET: u64 = 1_000;

    fn hand(cards: &[u8], doubled: bool) -> TableHand {
        let mut h = TableHand {
            doubled,
            n_cards: cards.len() as u8,
            ..Default::default()
        };
        h.cards[..cards.len()].copy_from_slice(cards);
        h
    }

    fn table(hands: &[TableHand], dealer: &[u8]) -> BlackjackTable {
        let mut t = BlackjackTable {
            bet: BET,
            n_hands: hands.len() as u8,
            n_dealer: dealer.len() as u8,
            ..Default::default()
        };
        t.hands[..hands.len()].copy_from_slice(hands);
        t.dealer[..dealer.len()].copy_from_slice(dealer);
        t
    }

    fn rng(i: u64) -> Rng {
        let mut seed = [0u8; 32];
        seed[..8].copy_from_slice(&i.to_le_bytes());
        Rng::from_vrf(seed)
    }

    /// Deals `n` hands from successive seeds until `keep` accepts the deal.
    fn dealt(n: u8, keep: impl Fn(&BlackjackTable, bool) -> bool) -> (BlackjackTable, Rng) {
        for i in 0u64.. {
            let mut r = rng(i);
            let mut t = BlackjackTable::default();
            t.start(BET, n);
            let over = t.deal(&mut r);
            if keep(&t, over) {
                return (t, r);
            }
        }
        unreachable!()
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
        let gross = |cards: &[u8], dealer: &[u8]| hand(cards, false).gross(dealer, BET);
        assert_eq!(gross(&[1, 13], &[9, 8]), 2_500, "blackjack 3:2");
        assert_eq!(gross(&[1, 13], &[1, 10]), 1_000, "blackjack vs blackjack");
        assert_eq!(gross(&[10, 9], &[1, 10]), 0, "dealer blackjack wins");
        assert_eq!(gross(&[10, 9], &[10, 8]), 2_000, "higher total wins 1:1");
        assert_eq!(gross(&[10, 8], &[10, 8]), 1_000, "equal totals push");
        assert_eq!(
            gross(&[10, 6, 9], &[2]),
            0,
            "bust loses even if dealer would"
        );
        assert_eq!(gross(&[10, 6], &[10, 6, 9]), 2_000, "dealer bust");
    }

    #[test]
    fn doubled_21_is_not_a_blackjack_and_loses_to_dealer_blackjack() {
        assert_eq!(hand(&[5, 6, 10], true).gross(&[9, 8], BET), 4_000);
        assert_eq!(hand(&[5, 6, 10], true).gross(&[1, 13], BET), 0);
    }

    #[test]
    fn gross_sums_every_hand_against_the_same_dealer() {
        let t = table(
            &[
                hand(&[1, 13], false),    // natural: 2 500
                hand(&[10, 9], false),    // 19 vs 18: 2 000
                hand(&[5, 6, 7], true),   // doubled 18 vs 18: push 2 000
                hand(&[10, 6, 9], false), // bust: 0
            ],
            &[10, 8],
        );
        assert_eq!(t.gross(), 2_500 + 2_000 + 2_000);
        assert_eq!(t.stake(), 5_000);
    }

    #[test]
    fn deal_gives_two_cards_per_hand_and_one_to_the_dealer() {
        for n in 1..=MAX_HANDS as u8 {
            let (t, _) = dealt(n, |_, over| !over);
            assert_eq!(t.n_hands, n);
            assert!(t.hands().iter().all(|h| h.n_cards == 2));
            assert_eq!(t.n_dealer, 1, "no dealer card while the player decides");
            assert!(t.hands[n as usize..].iter().all(|h| h.n_cards == 0));
        }
    }

    #[test]
    fn naturals_are_finished_at_deal() {
        let (t, _) = dealt(3, |t, over| !over && t.hands[0].is_natural());
        assert!(t.active > 0, "the natural is skipped");
        assert!(!t.active_hand().unwrap().is_natural());
    }

    #[test]
    fn a_natural_alone_draws_exactly_one_dealer_card() {
        let (t, _) = dealt(1, |_, over| over);
        assert!(t.hands[0].is_natural());
        assert_eq!(t.n_dealer, 2);
    }

    #[test]
    fn hands_are_played_left_to_right() {
        let (mut t, mut r) = dealt(3, |t, _| {
            t.active == 0 && t.hands().iter().all(|h| !h.is_natural())
        });
        assert!(!t.stand(), "two hands remain: no dealer draw");
        assert_eq!(t.active, 1);
        assert_eq!(t.n_dealer, 1);
        // Hit hand 1 until it is finished: play moves on to hand 2.
        while t.active == 1 {
            assert!(!t.hit(&mut r));
        }
        assert_eq!(t.active, 2);
        assert!(t.stand(), "last hand: the dealer must play");
        assert_eq!(t.active, 3);
        assert!(t.active_hand().is_none());
    }

    #[test]
    fn a_hand_reaching_21_is_finished() {
        let mut t = table(&[hand(&[10, 6, 5], false), hand(&[10, 2], false)], &[9]);
        let mut r = rng(0);
        assert!(!t.next_hand(&mut r));
        assert_eq!(t.active, 1);
    }

    #[test]
    fn double_takes_one_card_and_finishes_the_hand() {
        let (mut t, mut r) = dealt(2, |t, _| {
            t.active == 0 && t.hands[0].can_double() && !t.hands[1].is_natural()
        });
        let over = t.double(&mut r);
        assert!(!over);
        assert!(t.hands[0].doubled && t.hands[0].n_cards == 3);
        assert_eq!(t.active, 1);
        assert_eq!(
            t.stake(),
            3 * BET,
            "one extra bet for the doubled hand only"
        );
    }

    #[test]
    fn dealer_draws_nothing_when_every_hand_is_bust() {
        let mut t = table(&[hand(&[10, 6, 9], false), hand(&[10, 5, 10], true)], &[9]);
        t.active = 2;
        t.play_dealer(&mut rng(0));
        assert_eq!(t.n_dealer, 1);
        assert_eq!(t.gross(), 0);
    }

    #[test]
    fn dealer_draws_one_card_when_only_naturals_compete() {
        let mut t = table(&[hand(&[1, 13], false), hand(&[10, 6, 9], false)], &[9]);
        t.active = 2;
        t.play_dealer(&mut rng(0));
        assert_eq!(t.n_dealer, 2);
    }

    #[test]
    fn dealer_draws_to_17_when_a_hand_competes_on_total() {
        for i in 0..50 {
            let mut t = table(&[hand(&[1, 13], false), hand(&[10, 8], false)], &[6]);
            t.active = 2;
            t.play_dealer(&mut rng(i));
            assert!(total(t.dealer_cards()) >= 17);
        }
    }

    #[test]
    fn dealer_stands_on_soft_17() {
        let mut t = table(&[hand(&[10, 8], false)], &[1, 6]);
        t.active = 1;
        t.play_dealer(&mut rng(0));
        assert_eq!(t.dealer_cards(), &[1, 6]);
    }

    #[test]
    fn start_keeps_the_player_and_clears_the_last_round() {
        let mut t = table(&[hand(&[10, 8], true)], &[1, 6]);
        t.player = Pubkey::new_from_array([3; 32]);
        t.start(500, 2);
        assert_eq!(
            t,
            BlackjackTable {
                player: Pubkey::new_from_array([3; 32]),
                bet: 500,
                n_hands: 2,
                ..Default::default()
            }
        );
    }

    fn is_soft(cards: &[u8]) -> bool {
        cards.contains(&1) && cards.iter().map(|&c| c.min(10)).sum::<u8>() + 10 <= BLACKJACK
    }

    /// Simple basic strategy for this rule set (no split), each hand in turn.
    fn play(t: &mut BlackjackTable, rng: &mut Rng) {
        if t.deal(rng) {
            return;
        }
        let up = t.dealer[0].min(10);
        let up = if up == 1 { 11 } else { up };
        loop {
            let h = t.active_hand().unwrap();
            let (total, soft) = (h.total(), is_soft(h.cards()));
            let double = h.can_double()
                && !soft
                && (((total == 10 || total == 11) && up <= 9)
                    || (total == 9 && (3..=6).contains(&up)));
            let stand = if soft {
                total >= 19 || (total == 18 && up <= 8)
            } else {
                total >= 17 || (total >= 13 && up <= 6) || (total == 12 && (4..=6).contains(&up))
            };
            let over = if double {
                t.double(rng)
            } else if stand {
                if t.stand() {
                    t.play_dealer(rng);
                    true
                } else {
                    false
                }
            } else {
                t.hit(rng)
            };
            if over {
                return;
            }
        }
    }

    #[test]
    fn house_keeps_an_edge_with_basic_strategy() {
        for n_hands in [1, 3] {
            let (mut staked, mut returned) = (0u64, 0u64);
            for i in 0..400_000u64 / n_hands as u64 {
                let mut t = BlackjackTable::default();
                t.start(BET, n_hands);
                play(&mut t, &mut rng(i));
                staked += t.stake();
                returned += t.gross();
            }
            let rtp = returned as f64 / staked as f64;
            // No-hole-card, S17, 3:2, no split, infinite deck, this simple strategy: 98.7%
            // measured on one hand (seeds fixed). ±0.6% is 3 standard errors; losing the
            // double or 3:2 falls outside.
            assert!((0.981..0.993).contains(&rtp), "{n_hands} hands: RTP {rtp}");
        }
    }
}
