//! Tower (Dragon Tower): 9 levels of `tiles` tiles, `safe` of them safe; the player climbs one
//! level at a time and cashes out whenever they want. Like Mines nothing is stored ahead: each
//! climb takes its own VRF draw and the picked tile is safe iff `rng.below(tiles) < safe`.
//! After `L` safe levels the round returns `0.98 × (tiles / safe)^L` (RTP 98.00% at every
//! cash-out point, before Tilt's fee). A round returns at most `MAX_MULTIPLE` × its stake, like
//! Limbo's highest target.

use anchor_lang::prelude::*;

use crate::games::{gain, to_u64};
use crate::rng::Rng;

pub const LEVELS: u8 = 9;
/// `pending` / `busted` when there is no such tile.
pub const NONE: u8 = 255;
/// Most a round returns, × its stake: what it reserves of the bankroll scales with the stake.
pub const MAX_MULTIPLE: u64 = 10_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Debug)]
pub enum TowerDifficulty {
    Easy,
    Medium,
    Hard,
    Expert,
    Master,
}

impl TowerDifficulty {
    /// (tiles per level, safe tiles per level).
    pub fn tiles_and_safe(self) -> (u8, u8) {
        match self {
            Self::Easy => (4, 3),
            Self::Medium => (3, 2),
            Self::Hard => (2, 1),
            Self::Expert => (3, 1),
            Self::Master => (4, 1),
        }
    }

    pub fn tiles(self) -> u8 {
        self.tiles_and_safe().0
    }
}

/// What `levels` safe levels return for `stake`, before any cap and before Tilt's fee,
/// rounded down: `stake × 98 × tiles^L / (100 × safe^L)`. In u128: 4^9 = 2^18, no overflow.
pub fn gross_uncapped(stake: u64, difficulty: TowerDifficulty, levels: u8) -> u128 {
    let (tiles, safe) = difficulty.tiles_and_safe();
    let levels = levels as u32;
    stake as u128 * 98 * (tiles as u128).pow(levels) / (100 * (safe as u128).pow(levels))
}

/// Most a round can gain: every level climbed, at most `MAX_MULTIPLE` × the stake and
/// `max_round_gain`.
pub fn max_gain(stake: u64, difficulty: TowerDifficulty, max_round_gain: u64) -> u64 {
    let top = gross_uncapped(stake, difficulty, LEVELS);
    gain(stake, top.min(stake as u128 * MAX_MULTIPLE as u128)).min(max_round_gain)
}

/// One climb draw: is the picked tile safe?
pub fn is_safe(rng: &mut Rng, difficulty: TowerDifficulty) -> bool {
    let (tiles, safe) = difficulty.tiles_and_safe();
    rng.below(tiles as u64) < safe as u64
}

/// The player's Tower round. Lives in the rollup next to the player account; between rounds
/// it keeps the last round for display.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct TowerBoard {
    pub player: Pubkey,
    pub bet: u64,
    /// Most this round can gain, the cap on its gross return.
    pub max_gain: u64,
    pub difficulty: TowerDifficulty,
    /// The tile picked on each safe level; the first `level` count.
    pub climbed: [u8; LEVELS as usize],
    /// Safe levels climbed.
    pub level: u8,
    /// Tile awaiting its draw on level `level`, `NONE` otherwise.
    pub pending: u8,
    /// The tile that ended the round on level `level`, `NONE` otherwise.
    pub busted: u8,
}

impl Default for TowerBoard {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            bet: 0,
            max_gain: 0,
            difficulty: TowerDifficulty::Easy,
            climbed: [0; LEVELS as usize],
            level: 0,
            pending: NONE,
            busted: NONE,
        }
    }
}

impl TowerBoard {
    /// A fresh board for a new round; keeps only the player.
    pub fn start(&mut self, bet: u64, difficulty: TowerDifficulty, max_gain: u64) {
        *self = Self {
            player: self.player,
            bet,
            difficulty,
            max_gain,
            ..Self::default()
        };
    }

    fn in_play(&self) -> bool {
        self.pending == NONE && self.busted == NONE && self.level < LEVELS
    }

    /// A tile of the next level, while no other climb is pending.
    pub fn can_climb(&self, tile: u8) -> bool {
        self.in_play() && tile < self.difficulty.tiles()
    }

    /// Cash-out needs at least one safe level.
    pub fn can_cash_out(&self) -> bool {
        self.in_play() && self.level >= 1
    }

    fn cap(&self) -> u128 {
        self.bet as u128 + self.max_gain as u128
    }

    /// Gross return of a cash-out now: never above the stake plus `max_gain`.
    pub fn gross(&self) -> u64 {
        to_u64(gross_uncapped(self.bet, self.difficulty, self.level).min(self.cap()))
    }

    /// Plays the pending climb. Returns the gross return once the round is over: 0 on a bad
    /// tile, the cash-out at the top or once the cap is reached; `None` when the board goes
    /// back to the player. Needs a pending tile (`can_climb` held for it).
    pub fn climb(&mut self, rng: &mut Rng) -> Option<u64> {
        let tile = self.pending;
        self.pending = NONE;
        if !is_safe(rng, self.difficulty) {
            self.busted = tile;
            return Some(0);
        }
        self.climbed[self.level as usize] = tile;
        self.level += 1;
        let top = self.level == LEVELS;
        let capped = gross_uncapped(self.bet, self.difficulty, self.level) >= self.cap();
        (top || capped).then(|| self.gross())
    }
}

/// Test helper: a VRF output whose climb is safe (or not).
#[cfg(test)]
pub(crate) fn randomness_for(difficulty: TowerDifficulty, safe: bool) -> [u8; 32] {
    (0..=u16::MAX)
        .map(|i| {
            let mut randomness = [0; 32];
            randomness[..2].copy_from_slice(&i.to_le_bytes());
            randomness
        })
        .find(|&r| is_safe(&mut Rng::from_vrf(r), difficulty) == safe)
        .expect("some randomness")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFFICULTIES: [TowerDifficulty; 5] = [
        TowerDifficulty::Easy,
        TowerDifficulty::Medium,
        TowerDifficulty::Hard,
        TowerDifficulty::Expert,
        TowerDifficulty::Master,
    ];

    fn board(difficulty: TowerDifficulty, max_round_gain: u64) -> TowerBoard {
        let mut b = TowerBoard::default();
        b.start(
            1_000,
            difficulty,
            max_gain(1_000, difficulty, max_round_gain),
        );
        b
    }

    fn climb(b: &mut TowerBoard, tile: u8, safe: bool) -> Option<u64> {
        assert!(b.can_climb(tile));
        b.pending = tile;
        b.climb(&mut Rng::from_vrf(randomness_for(b.difficulty, safe)))
    }

    #[test]
    fn multipliers() {
        // Hard: 1.96× per level.
        assert_eq!(gross_uncapped(1_000, TowerDifficulty::Hard, 1), 1_960);
        assert_eq!(gross_uncapped(1_000, TowerDifficulty::Hard, 2), 3_920);
        // Easy: 0.98 × 4/3 = 1.3066…
        assert_eq!(gross_uncapped(1_000, TowerDifficulty::Easy, 1), 1_306);
        // Master, top: 0.98 × 4^9 = 256 901.12×.
        assert_eq!(gross_uncapped(100, TowerDifficulty::Master, 9), 25_690_112);
        assert_eq!(
            max_gain(1_000, TowerDifficulty::Medium, u64::MAX),
            37_674 - 1_000
        );
        // Expert (19 289×) and Master (256 901×) stop at a 10 000× return.
        assert_eq!(
            max_gain(1_000, TowerDifficulty::Expert, u64::MAX),
            9_999_000
        );
        assert_eq!(
            max_gain(1_000, TowerDifficulty::Master, u64::MAX),
            9_999_000
        );
        assert_eq!(max_gain(1_000, TowerDifficulty::Master, 50_000), 50_000);
        assert_eq!(
            max_gain(u64::MAX, TowerDifficulty::Master, u64::MAX),
            u64::MAX
        );
    }

    #[test]
    fn rtp_is_98_percent_at_every_cash_out_point() {
        // P(L safe) = (safe / tiles)^L, so gross × P = 0.98 stake, less the floor.
        let stake = 1_000_000_000u64;
        for difficulty in DIFFICULTIES {
            let (tiles, safe) = difficulty.tiles_and_safe();
            for levels in 1..=LEVELS as u32 {
                let ev = gross_uncapped(stake, difficulty, levels as u8)
                    * (safe as u128).pow(levels)
                    / (tiles as u128).pow(levels);
                assert!(980_000_000 - ev <= 1, "{difficulty:?} {levels}: {ev}");
            }
        }
    }

    #[test]
    fn a_safe_climb_goes_back_to_the_player_and_a_bad_tile_busts() {
        let mut b = board(TowerDifficulty::Medium, 1_000_000);
        assert!(!b.can_cash_out());
        assert_eq!(climb(&mut b, 2, true), None);
        assert_eq!((b.level, b.climbed[0], b.pending), (1, 2, NONE));
        assert!(b.can_cash_out());
        assert_eq!(b.gross(), 1_470);
        assert_eq!(climb(&mut b, 0, false), Some(0));
        assert_eq!((b.level, b.busted), (1, 0));
        assert!(!b.can_climb(1) && !b.can_cash_out());
    }

    #[test]
    fn the_top_cashes_out() {
        let mut b = board(TowerDifficulty::Easy, 1_000_000);
        for level in 0..LEVELS - 1 {
            assert_eq!(climb(&mut b, level % 4, true), None);
        }
        assert_eq!(climb(&mut b, 3, true), Some(13_051));
        assert_eq!(b.level, LEVELS);
        assert!(!b.can_climb(0));
    }

    #[test]
    fn reaching_the_cap_cashes_out_at_the_cap() {
        // Hard from 1 000, round limit 2 000: 3.92× on level 2 passes the 3 000 cap.
        let mut b = board(TowerDifficulty::Hard, 2_000);
        assert_eq!(climb(&mut b, 0, true), None);
        assert_eq!(climb(&mut b, 1, true), Some(3_000));
    }

    #[test]
    fn the_max_gain_cashes_out_at_10_000x_the_stake() {
        // Master: 6 levels return 0.98 × 4^6 = 4 014×, 7 return 16 056×.
        let mut b = board(TowerDifficulty::Master, u64::MAX);
        for level in 0..6 {
            assert_eq!(climb(&mut b, level % 4, true), None);
        }
        assert_eq!(climb(&mut b, 0, true), Some(10_000_000));
        assert_eq!(b.level, 7);
    }

    #[test]
    fn refused_climbs() {
        let mut b = board(TowerDifficulty::Hard, 1_000_000);
        assert!(!b.can_climb(2), "hard has 2 tiles");
        assert!(!b.can_climb(NONE));
        b.pending = 1;
        assert!(!b.can_climb(0) && !b.can_cash_out(), "a climb is pending");
        let master = board(TowerDifficulty::Master, 1_000_000);
        assert!(master.can_climb(3) && !master.can_climb(4));
    }

    #[test]
    fn a_tile_is_safe_as_often_as_the_difficulty_says() {
        let mut rng = Rng::from_vrf([12; 32]);
        let n = 120_000;
        let safe = (0..n)
            .filter(|_| is_safe(&mut rng, TowerDifficulty::Easy))
            .count();
        // Expected 90 000; 5 sigma is about 750.
        assert!((89_250..=90_750).contains(&safe), "{safe}");
    }

    #[test]
    fn board_layout_is_fixed() {
        // Delegated accounts cannot be resized: changing this needs a new seed.
        assert_eq!(TowerBoard::INIT_SPACE, 61);
    }
}
