//! The one-draw games (Dice, Limbo, Flip, Keno, Wheel) keep their last round in one PDA per
//! player, `QuickTable`: the choice at bet time, then the outcome of its single VRF draw.

use anchor_lang::prelude::*;

use crate::games::{
    dice, flip,
    flip::CoinSide,
    keno, limbo,
    wheel::{self, WheelRisk},
};
use crate::rng::Rng;
use crate::state::Game;

/// A one-draw round: the player's choice, and the outcome once drawn (zeros before).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum QuickRound {
    /// No round played yet.
    Empty,
    /// `roll` in `0..10 000`.
    Dice { target: u16, over: bool, roll: u16 },
    /// Multipliers ×100.
    Limbo { target: u32, result: u32 },
    /// `coins`: bit `i` set when coin `i` landed tails.
    Flip {
        side: CoinSide,
        flips: u8,
        coins: u16,
    },
    /// The first `n_picks` of `picks` count; `drawn` in draw order.
    Keno {
        picks: [u8; keno::MAX_PICKS],
        n_picks: u8,
        drawn: [u8; keno::DRAWN],
    },
    Wheel {
        segments: u8,
        risk: WheelRisk,
        segment: u8,
    },
}

impl QuickRound {
    pub fn game(&self) -> Option<Game> {
        match self {
            Self::Empty => None,
            Self::Dice { .. } => Some(Game::Dice),
            Self::Limbo { .. } => Some(Game::Limbo),
            Self::Flip { .. } => Some(Game::Flip),
            Self::Keno { .. } => Some(Game::Keno),
            Self::Wheel { .. } => Some(Game::Wheel),
        }
    }

    /// A Keno round on `picks`, `None` when there are more than 10.
    pub fn keno(picks: &[u8]) -> Option<Self> {
        let mut round = [0; keno::MAX_PICKS];
        round.get_mut(..picks.len())?.copy_from_slice(picks);
        Some(Self::Keno {
            picks: round,
            n_picks: picks.len() as u8,
            drawn: [0; keno::DRAWN],
        })
    }

    fn keno_picks(picks: &[u8; keno::MAX_PICKS], n_picks: u8) -> &[u8] {
        &picks[..(n_picks as usize).min(keno::MAX_PICKS)]
    }

    /// Most the round can gain for `stake`, `None` when the choice breaks the game's rules.
    /// Never capped: a choice that could gain more than a round allows is refused.
    pub fn max_gain(&self, stake: u64) -> Option<u64> {
        match *self {
            Self::Empty => None,
            Self::Dice { target, over, .. } => dice::max_gain(stake, target, over),
            Self::Limbo { target, .. } => limbo::max_gain(stake, target),
            Self::Flip { flips, .. } => flip::max_gain(stake, flips),
            Self::Keno {
                ref picks, n_picks, ..
            } => keno::max_gain(stake, Self::keno_picks(picks, n_picks)),
            Self::Wheel { segments, risk, .. } => wheel::max_gain(stake, risk, segments),
        }
    }

    /// Draws the outcome and returns what the round pays back for `stake`. Needs a choice
    /// `max_gain` accepted.
    pub fn play(&mut self, stake: u64, rng: &mut Rng) -> u64 {
        match self {
            Self::Empty => unreachable!("no round to play"),
            Self::Dice { target, over, roll } => {
                *roll = dice::roll(rng);
                dice::gross(stake, *target, *over, *roll)
            }
            Self::Limbo { target, result } => {
                *result = limbo::result(rng);
                limbo::gross(stake, *target, *result)
            }
            Self::Flip { side, flips, coins } => {
                *coins = flip::toss(rng, *flips);
                flip::gross(stake, *side, *flips, *coins)
            }
            Self::Keno {
                picks,
                n_picks,
                drawn,
            } => {
                *drawn = keno::draw(rng);
                let picks = Self::keno_picks(picks, *n_picks);
                keno::gross(stake, picks.len(), keno::hits(picks, drawn))
            }
            Self::Wheel {
                segments,
                risk,
                segment,
            } => {
                *segment = wheel::spin(rng, *segments);
                wheel::gross(stake, *risk, *segments, *segment)
            }
        }
    }
}

/// The player's last one-draw round, of any of the five games. Lives in the rollup next to
/// the player account.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct QuickTable {
    pub player: Pubkey,
    pub bet: u64,
    pub round: QuickRound,
    /// The outcome in `round` has been drawn.
    pub drawn: bool,
}

impl Default for QuickTable {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            bet: 0,
            round: QuickRound::Empty,
            drawn: false,
        }
    }
}

impl QuickTable {
    /// A new round of `bet` on `round`, waiting for its draw; keeps only the player.
    pub fn start(&mut self, bet: u64, round: QuickRound) {
        *self = Self {
            player: self.player,
            bet,
            round,
            drawn: false,
        };
    }

    /// Plays the awaited draw and returns the round's gross return.
    pub fn play(&mut self, rng: &mut Rng) -> u64 {
        self.drawn = true;
        self.round.play(self.bet, rng)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_round_belongs_to_its_game() {
        assert_eq!(QuickRound::Empty.game(), None);
        assert_eq!(QuickRound::keno(&[1, 2]).unwrap().game(), Some(Game::Keno));
        assert_eq!(
            QuickRound::Limbo {
                target: 200,
                result: 0
            }
            .game(),
            Some(Game::Limbo)
        );
    }

    #[test]
    fn choices_outside_the_rules_have_no_max_gain() {
        assert_eq!(QuickRound::Empty.max_gain(1_000), None);
        assert_eq!(QuickRound::keno(&[0; 11]), None, "more than 10 picks");
        assert_eq!(QuickRound::keno(&[]).unwrap().max_gain(1_000), None);
        assert_eq!(QuickRound::keno(&[4, 4]).unwrap().max_gain(1_000), None);
        let dice = QuickRound::Dice {
            target: 9_900,
            over: false,
            roll: 0,
        };
        assert_eq!(dice.max_gain(1_000), None);
        let flip = QuickRound::Flip {
            side: CoinSide::Heads,
            flips: 11,
            coins: 0,
        };
        assert_eq!(flip.max_gain(1_000), None);
        let wheel = QuickRound::Wheel {
            segments: 15,
            risk: WheelRisk::Low,
            segment: 0,
        };
        assert_eq!(wheel.max_gain(1_000), None);
        assert_eq!(QuickRound::keno(&[7]).unwrap().max_gain(1_000), Some(2_800));
    }

    #[test]
    fn playing_records_the_outcome_and_pays_it() {
        let mut table = QuickTable::default();
        table.start(
            1_000,
            QuickRound::keno(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).unwrap(),
        );
        assert!(!table.drawn);
        let gross = table.play(&mut Rng::from_vrf([3; 32]));
        assert!(table.drawn);
        let QuickRound::Keno { picks, drawn, .. } = table.round else {
            panic!("keno round");
        };
        assert!(keno::is_valid(&drawn));
        assert_eq!(gross, keno::gross(1_000, 10, keno::hits(&picks, &drawn)));

        let mut rng = Rng::from_vrf([4; 32]);
        let mut expected = Rng::from_vrf([4; 32]);
        table.start(
            500,
            QuickRound::Dice {
                target: 5_000,
                over: true,
                roll: 0,
            },
        );
        let gross = table.play(&mut rng);
        let roll = dice::roll(&mut expected);
        assert_eq!(
            table.round,
            QuickRound::Dice {
                target: 5_000,
                over: true,
                roll
            }
        );
        assert_eq!(gross, dice::gross(500, 5_000, true, roll));
    }

    #[test]
    fn table_layout_is_fixed() {
        // Delegated accounts cannot be resized: changing this needs a new seed. The largest
        // round (Keno) is 21 bytes plus the tag.
        assert_eq!(QuickTable::INIT_SPACE, 32 + 8 + 22 + 1);
    }
}
