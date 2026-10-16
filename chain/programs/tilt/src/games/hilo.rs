//! Hilo: cards from an infinite deck; the player guesses whether the next card ranks higher
//! (or equal) or lower (or equal) than the current one, or skips it, and cashes out whenever
//! they want. At the edges, where "or equal" would be certain, the bet is strict: lower from
//! a king wins on 1..=12, higher from an ace on 2..=13. Each card is its own VRF draw. A right
//! guess multiplies the fair multiplier by `13 / winning ranks`; the round pays `0.98 ×` the
//! fair multiplier (RTP 98.00% at every cash-out point, before Tilt's fee).

use anchor_lang::prelude::*;

use crate::games::to_u64;
use crate::rng::Rng;

pub const RANKS: u8 = 13;
/// Cards are `0..52`: rank `card % 13 + 1` (ace 1 low, king 13), suit `card / 13`.
pub const CARDS: u8 = 52;
/// Cards a round keeps; the card that fills the board cashes out.
pub const MAX_CARDS: usize = 64;
pub const MAX_SKIPS: u8 = 10;
/// The fair multiplier is fixed point: `FAIR_ONE` = 1×.
pub const FAIR_ONE: u128 = 1_000_000;
/// `pending` when no guess waits for its card.
pub const NONE: u8 = 255;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum HiloMove {
    /// Next rank ≥ current.
    Higher,
    /// Next rank ≤ current.
    Lower,
    /// A new card, the multiplier unchanged.
    Skip,
}

impl HiloMove {
    /// The byte stored on the board (the guess's position in the enum).
    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn from_code(code: u8) -> Option<Self> {
        [Self::Higher, Self::Lower, Self::Skip]
            .get(code as usize)
            .copied()
    }
}

pub fn rank(card: u8) -> u8 {
    card % RANKS + 1
}

pub fn draw_card(rng: &mut Rng) -> u8 {
    rng.below(CARDS as u64) as u8
}

/// Ranks winning `guess` from `rank` (`None` for a skip). Never 13: at the edges the bet is strict.
pub fn winning_ranks(guess: HiloMove, rank: u8) -> Option<u8> {
    match guess {
        HiloMove::Higher if rank == 1 => Some(RANKS - 1),
        HiloMove::Higher => Some(RANKS + 1 - rank),
        HiloMove::Lower if rank == RANKS => Some(RANKS - 1),
        HiloMove::Lower => Some(rank),
        HiloMove::Skip => None,
    }
}

pub fn is_right(guess: HiloMove, current: u8, next: u8) -> bool {
    match guess {
        HiloMove::Higher if current == 1 => next > current,
        HiloMove::Higher => next >= current,
        HiloMove::Lower if current == RANKS => next < current,
        HiloMove::Lower => next <= current,
        HiloMove::Skip => true,
    }
}

/// The fair multiplier after a right guess with `winning` ranks, rounded down.
pub fn next_fair(fair: u128, winning: u8) -> u128 {
    fair.saturating_mul(RANKS as u128) / winning as u128
}

/// What a cash-out at `fair` returns, before any cap, rounded down: `stake × 0.98 × fair`.
/// Saturates: a product past u128 is far above any cap.
pub fn gross_uncapped(stake: u64, fair: u128) -> u128 {
    (stake as u128).saturating_mul(98).saturating_mul(fair) / (100 * FAIR_ONE)
}

/// The player's Hilo round. Lives in the rollup next to the player account; between rounds
/// it keeps the last round for display.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct HiloBoard {
    pub player: Pubkey,
    pub bet: u64,
    /// Most this round can gain, the cap on its gross return.
    pub max_gain: u64,
    /// Fair multiplier (×`FAIR_ONE`), before the house edge.
    pub fair: u128,
    /// Cards drawn, the first `n_cards` count.
    pub cards: [u8; MAX_CARDS],
    pub n_cards: u8,
    /// `guesses[i]` (a `HiloMove` code) led to `cards[i + 1]`.
    pub guesses: [u8; MAX_CARDS - 1],
    pub n_right: u8,
    pub skips: u8,
    /// The guess awaiting its card (`HiloMove` code), `NONE` otherwise.
    pub pending: u8,
    /// The last card proved the guess wrong.
    pub busted: bool,
}

impl Default for HiloBoard {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            bet: 0,
            max_gain: 0,
            fair: FAIR_ONE,
            cards: [0; MAX_CARDS],
            n_cards: 0,
            guesses: [0; MAX_CARDS - 1],
            n_right: 0,
            skips: 0,
            pending: NONE,
            busted: false,
        }
    }
}

impl HiloBoard {
    /// A fresh board for a new round, waiting for its first card; keeps only the player.
    pub fn start(&mut self, bet: u64, max_gain: u64) {
        *self = Self {
            player: self.player,
            bet,
            max_gain,
            ..Self::default()
        };
    }

    pub fn current_rank(&self) -> Option<u8> {
        let last = (self.n_cards as usize).checked_sub(1)?;
        Some(rank(self.cards[last]))
    }

    fn in_play(&self) -> bool {
        self.n_cards >= 1 && self.pending == NONE && !self.busted
    }

    /// A guess the rules allow now: never a certain one, at most `MAX_SKIPS` skips.
    pub fn can_guess(&self, guess: HiloMove) -> bool {
        let Some(rank) = self.current_rank() else {
            return false;
        };
        self.in_play()
            && match winning_ranks(guess, rank) {
                Some(winning) => winning < RANKS,
                None => self.skips < MAX_SKIPS,
            }
    }

    /// Cash-out needs at least one right guess.
    pub fn can_cash_out(&self) -> bool {
        self.in_play() && self.n_right >= 1
    }

    /// A card is due: the round's first, or the pending guess's.
    pub fn awaits_card(&self) -> bool {
        !self.busted && (self.n_cards == 0) == (self.pending == NONE)
    }

    fn cap(&self) -> u128 {
        self.bet as u128 + self.max_gain as u128
    }

    /// Gross return of a cash-out now: never above the stake plus `max_gain`.
    pub fn gross(&self) -> u64 {
        to_u64(gross_uncapped(self.bet, self.fair).min(self.cap()))
    }

    /// Plays the awaited card (`awaits_card` held): the first card of the round, or the
    /// pending guess's. Returns the gross return once the round is over: 0 on a wrong guess,
    /// the cash-out once the cap is reached or the board is full; `None` when the board goes
    /// back to the player.
    pub fn draw(&mut self, rng: &mut Rng) -> Option<u64> {
        let card = draw_card(rng);
        let pending = self.pending;
        self.pending = NONE;
        let current = self.current_rank();
        self.cards[self.n_cards as usize] = card;
        self.n_cards += 1;
        let (Some(current), Some(guess)) = (current, HiloMove::from_code(pending)) else {
            // The first card.
            return None;
        };
        self.guesses[self.n_cards as usize - 2] = guess.code();
        match winning_ranks(guess, current) {
            None => self.skips += 1,
            Some(_) if !is_right(guess, current, rank(card)) => {
                self.busted = true;
                return Some(0);
            }
            Some(winning) => {
                self.fair = next_fair(self.fair, winning);
                self.n_right += 1;
            }
        }
        let full = self.n_cards as usize == MAX_CARDS;
        let capped = gross_uncapped(self.bet, self.fair) >= self.cap();
        // A full board has at least 53 right guesses (skips are limited): a cash-out.
        (full || capped).then(|| self.gross())
    }
}

/// Test helper: a VRF output whose card has rank `rank`.
#[cfg(test)]
pub(crate) fn randomness_for(rank_wanted: u8) -> [u8; 32] {
    (0..=u16::MAX)
        .map(|i| {
            let mut randomness = [0; 32];
            randomness[..2].copy_from_slice(&i.to_le_bytes());
            randomness
        })
        .find(|&r| rank(draw_card(&mut Rng::from_vrf(r))) == rank_wanted)
        .expect("some randomness")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A board of 1 000 showing `first`.
    fn board(first: u8, max_gain: u64) -> HiloBoard {
        let mut b = HiloBoard::default();
        b.start(1_000, max_gain);
        assert_eq!(b.draw(&mut Rng::from_vrf(randomness_for(first))), None);
        b
    }

    fn guess(b: &mut HiloBoard, guess: HiloMove, next: u8) -> Option<u64> {
        assert!(b.can_guess(guess), "{guess:?}");
        b.pending = guess.code();
        b.draw(&mut Rng::from_vrf(randomness_for(next)))
    }

    #[test]
    fn the_first_card_goes_to_the_player() {
        let b = board(7, 1_000_000);
        assert_eq!((b.n_cards, b.current_rank()), (1, Some(7)));
        assert_eq!((b.fair, b.n_right, b.pending), (FAIR_ONE, 0, NONE));
        assert!(!b.can_cash_out(), "no right guess yet");
        assert!(b.can_guess(HiloMove::Higher) && b.can_guess(HiloMove::Lower));
    }

    #[test]
    fn a_right_guess_multiplies_by_13_over_the_winning_ranks() {
        let mut b = board(7, 1_000_000);
        // Higher from 7: 7 winning ranks (7..=13), equal wins.
        assert_eq!(guess(&mut b, HiloMove::Higher, 7), None);
        assert_eq!(b.fair, 1_857_142);
        assert_eq!(b.guesses[0], HiloMove::Higher.code());
        // 1 000 × 0.98 × 1.857142 = 1 819.99…
        assert_eq!(b.gross(), 1_819);
        assert!(b.can_cash_out());
        // Lower from 2: 2 winning ranks.
        let mut b = board(2, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Lower, 1), None);
        assert_eq!(b.fair, 6_500_000);
        assert_eq!(b.gross(), 6_370);
    }

    #[test]
    fn a_wrong_guess_busts_the_round() {
        let mut b = board(7, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Higher, 6), Some(0));
        assert!(b.busted);
        assert_eq!((b.n_cards, b.n_right), (2, 0));
        assert!(!b.can_guess(HiloMove::Lower) && !b.can_cash_out());
    }

    #[test]
    fn lower_from_a_king_is_strict() {
        for next in 1..RANKS {
            let mut b = board(13, 1_000_000);
            assert_eq!(guess(&mut b, HiloMove::Lower, next), None, "{next}");
            // 13 / 12, rounded down.
            assert_eq!((b.fair, b.n_right), (1_083_333, 1));
        }
        let mut b = board(13, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Lower, 13), Some(0));
        // Higher from a king stays "or equal": the king only, 13×.
        let mut b = board(13, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Higher, 13), None);
        assert_eq!(b.fair, 13_000_000);
    }

    #[test]
    fn higher_from_an_ace_is_strict() {
        for next in 2..=RANKS {
            let mut b = board(1, 1_000_000);
            assert_eq!(guess(&mut b, HiloMove::Higher, next), None, "{next}");
            assert_eq!((b.fair, b.n_right), (1_083_333, 1));
        }
        let mut b = board(1, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Higher, 1), Some(0));
        // Lower from an ace stays "or equal": the ace only, 13×.
        let mut b = board(1, 1_000_000);
        assert_eq!(guess(&mut b, HiloMove::Lower, 1), None);
        assert_eq!(b.fair, 13_000_000);
    }

    #[test]
    fn other_ranks_keep_or_equal() {
        for current in 2..RANKS {
            assert_eq!(winning_ranks(HiloMove::Higher, current), Some(14 - current));
            assert_eq!(winning_ranks(HiloMove::Lower, current), Some(current));
            assert!(is_right(HiloMove::Higher, current, current));
            assert!(is_right(HiloMove::Lower, current, current));
        }
    }

    #[test]
    fn no_guess_is_certain() {
        for current in 1..=RANKS {
            let b = board(current, 1_000_000);
            for guess in [HiloMove::Higher, HiloMove::Lower] {
                assert!(
                    winning_ranks(guess, current).unwrap() < RANKS,
                    "{guess:?} from {current}"
                );
                assert!(b.can_guess(guess), "{guess:?} from {current}");
            }
        }
    }

    #[test]
    fn skips_change_the_card_but_not_the_multiplier_ten_times_at_most() {
        let mut b = board(5, 1_000_000);
        for i in 0..MAX_SKIPS {
            assert_eq!(guess(&mut b, HiloMove::Skip, 3 + i % 5), None);
        }
        assert_eq!((b.fair, b.skips, b.n_right), (FAIR_ONE, MAX_SKIPS, 0));
        assert!(!b.can_guess(HiloMove::Skip));
        assert!(!b.can_cash_out(), "skips are not right guesses");
        assert_eq!(b.guesses[9], HiloMove::Skip.code());
    }

    #[test]
    fn nothing_moves_while_a_card_is_pending_or_before_the_first() {
        let mut b = HiloBoard::default();
        b.start(1_000, 1_000_000);
        assert!(!b.can_guess(HiloMove::Skip) && !b.can_cash_out());
        let mut b = board(5, 1_000_000);
        guess(&mut b, HiloMove::Higher, 9);
        b.pending = HiloMove::Lower.code();
        assert!(!b.can_guess(HiloMove::Higher) && !b.can_cash_out());
    }

    #[test]
    fn reaching_the_cap_cashes_out_at_the_cap() {
        // 1 000, round limit 3 000: ace then lower ×1 (13×) passes the 4 000 cap.
        let mut b = board(1, 3_000);
        assert_eq!(guess(&mut b, HiloMove::Lower, 1), Some(4_000));
    }

    #[test]
    fn a_full_board_cashes_out() {
        let mut b = board(7, u64::MAX / 2);
        b.n_cards = MAX_CARDS as u8 - 1;
        b.cards[b.n_cards as usize - 1] = 6; // rank 7
        assert_eq!(guess(&mut b, HiloMove::Higher, 8), Some(1_819));
    }

    #[test]
    fn huge_multipliers_saturate_instead_of_overflowing() {
        assert_eq!(next_fair(u128::MAX, 1), u128::MAX);
        assert!(gross_uncapped(u64::MAX, u128::MAX / 2) > u64::MAX as u128);
    }

    #[test]
    fn every_guess_keeps_98_percent() {
        // EV of a right guess: P = winning / 13, fair × 13 / winning: the same fair, less the floor.
        let fair = 3_141_592u128;
        for current in 1..=RANKS {
            for guess in [HiloMove::Higher, HiloMove::Lower] {
                let winning = winning_ranks(guess, current).unwrap();
                let right = (1..=RANKS)
                    .filter(|&next| is_right(guess, current, next))
                    .count() as u8;
                assert_eq!(right, winning, "{guess:?} from {current}");
                assert!(winning < RANKS, "{guess:?} from {current}");
                let ev = next_fair(fair, winning) * winning as u128 / RANKS as u128;
                assert!(fair - ev <= 1, "{guess:?} from {current}: {ev}");
            }
        }
    }

    #[test]
    fn card_ranks_and_suits() {
        assert_eq!((rank(0), rank(12), rank(13), rank(51)), (1, 13, 1, 13));
        let mut rng = Rng::from_vrf([11; 32]);
        assert!((0..10_000).all(|_| draw_card(&mut rng) < CARDS));
    }

    #[test]
    fn board_layout_is_fixed() {
        // Delegated accounts cannot be resized: changing this needs a new seed.
        assert_eq!(HiloBoard::INIT_SPACE, 196);
    }
}
