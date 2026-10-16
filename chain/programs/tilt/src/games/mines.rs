//! Mines: a 5×5 board hiding `mines` mines; the player reveals tiles one at a time and cashes
//! out whenever they want, the multiplier growing with every safe tile.
//!
//! No layout is ever drawn: everything on Solana is public, a stored layout could be read.
//! Each reveal takes its own VRF draw instead: with `k` tiles already revealed (all safe), the
//! clicked tile is a mine iff `rng.below(25 - k) < mines`, distributed exactly like a uniformly
//! random layout. The multiplier after `k` safe tiles is `0.99 × C(25, k) / C(25 − mines, k)`
//! (RTP 99.00% before Tilt's fee, at every cash-out point).

use anchor_lang::prelude::*;

use crate::rng::Rng;

pub const TILES: u8 = 25;
pub const MAX_MINES: u8 = TILES - 1;
/// `pending` / `busted` when there is no such tile.
pub const NONE: u8 = 255;
/// The house edge: every multiplier is the fair one times 99/100.
const RETURN_PERCENT: u128 = 99;

/// `C(n, k)`, exact for `n <= 25` (at most `C(25, 12)` = 5 200 300).
fn choose(n: u8, k: u8) -> u128 {
    if k > n {
        return 0;
    }
    // Each partial product is itself a binomial coefficient, so every division is exact.
    (0..k as u128).fold(1, |c, i| c * (n as u128 - i) / (i + 1))
}

/// What `k` safe tiles return for `stake` with `mines` mines, before any cap and before
/// Tilt's fee, rounded down. Needs `1 <= mines <= 24` and `k <= 25 - mines`. In u128: no
/// stake can overflow it (u64 × 99 × C(25, 12) < 2^94).
pub fn gross_uncapped(stake: u64, mines: u8, k: u8) -> u128 {
    stake as u128 * RETURN_PERCENT * choose(TILES, k) / (100 * choose(TILES - mines, k))
}

/// Most a round with `mines` mines can gain: every safe tile revealed, at most
/// `max_round_gain`. Saturates like every game's `max_gain`, so a huge stake is refused as
/// out of range by `start_round` instead of panicking.
pub fn max_gain(stake: u64, mines: u8, max_round_gain: u64) -> u64 {
    let full = gross_uncapped(stake, mines, TILES - mines);
    let gain = full.saturating_sub(stake as u128);
    u64::try_from(gain).unwrap_or(u64::MAX).min(max_round_gain)
}

/// One reveal draw with `k` tiles already revealed: is the clicked tile a mine?
pub fn is_mine(rng: &mut Rng, mines: u8, k: u8) -> bool {
    rng.below((TILES - k) as u64) < mines as u64
}

/// The player's Mines round. Lives in the rollup next to the player account; between rounds
/// it keeps the last round for display.
#[account]
#[derive(InitSpace, Debug, PartialEq, Eq)]
pub struct MinesBoard {
    pub player: Pubkey,
    pub bet: u64,
    pub mines: u8,
    /// One bit per tile revealed safe (bit `tile`).
    pub revealed: u32,
    /// Tiles revealed safe, in reveal order; the first `n_revealed` count.
    pub order: [u8; TILES as usize],
    pub n_revealed: u8,
    /// Tile awaiting its draw, `NONE` otherwise.
    pub pending: u8,
    /// The mine that ended the round, `NONE` otherwise.
    pub busted: u8,
    /// Most this round can gain (`max_gain`), the cap on its gross return.
    pub max_gain: u64,
}

impl Default for MinesBoard {
    fn default() -> Self {
        Self {
            player: Pubkey::default(),
            bet: 0,
            mines: 0,
            revealed: 0,
            order: [0; TILES as usize],
            n_revealed: 0,
            pending: NONE,
            busted: NONE,
            max_gain: 0,
        }
    }
}

impl MinesBoard {
    /// A fresh board for a new round; keeps only the player.
    pub fn start(&mut self, bet: u64, mines: u8, max_gain: u64) {
        *self = Self {
            player: self.player,
            bet,
            mines,
            max_gain,
            ..Self::default()
        };
    }

    pub fn is_revealed(&self, tile: u8) -> bool {
        tile < TILES && self.revealed & (1 << tile) != 0
    }

    /// A tile on the board, not revealed yet, while no other reveal is pending.
    pub fn can_reveal(&self, tile: u8) -> bool {
        tile < TILES && !self.is_revealed(tile) && self.pending == NONE
    }

    /// Cash-out needs at least one safe tile (with none it would just refund the stake).
    pub fn can_cash_out(&self) -> bool {
        self.n_revealed >= 1 && self.pending == NONE
    }

    /// The tiles revealed safe, in reveal order.
    pub fn revealed_tiles(&self) -> &[u8] {
        &self.order[..self.n_revealed as usize]
    }

    /// Gross return of a cash-out now: never above the stake plus `max_gain`.
    pub fn gross(&self) -> u64 {
        let cap = self.bet as u128 + self.max_gain as u128;
        let gross = gross_uncapped(self.bet, self.mines, self.n_revealed).min(cap);
        u64::try_from(gross).expect("mines gross exceeds u64")
    }

    /// Plays the pending reveal. Returns the gross return once the round is over: 0 on a
    /// mine, the cash-out after the last safe tile or once the cap is reached; `None` when
    /// the board goes back to the player. Needs a pending tile (`can_reveal` held for it).
    pub fn reveal(&mut self, rng: &mut Rng) -> Option<u64> {
        let tile = self.pending;
        self.pending = NONE;
        if is_mine(rng, self.mines, self.n_revealed) {
            self.busted = tile;
            return Some(0);
        }
        self.revealed |= 1 << tile;
        self.order[self.n_revealed as usize] = tile;
        self.n_revealed += 1;
        let cleared = self.n_revealed == TILES - self.mines;
        let capped = gross_uncapped(self.bet, self.mines, self.n_revealed)
            >= self.bet as u128 + self.max_gain as u128;
        (cleared || capped).then(|| self.gross())
    }
}

/// Test helper: a VRF output whose reveal with `k` tiles revealed and `mines` mines is a
/// mine (or safe).
#[cfg(test)]
pub(crate) fn randomness_for(mines: u8, k: u8, mine: bool) -> [u8; 32] {
    (0..=u16::MAX)
        .map(|i| {
            let mut randomness = [0; 32];
            randomness[..2].copy_from_slice(&i.to_le_bytes());
            randomness
        })
        .find(|&r| is_mine(&mut Rng::from_vrf(r), mines, k) == mine)
        .expect("some randomness")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(bet: u64, mines: u8, max_round_gain: u64) -> MinesBoard {
        let mut b = MinesBoard::default();
        b.start(bet, mines, max_gain(bet, mines, max_round_gain));
        b
    }

    /// Reveals `tile` with the draw `randomness`.
    fn reveal(b: &mut MinesBoard, tile: u8, randomness: [u8; 32]) -> Option<u64> {
        assert!(b.can_reveal(tile));
        b.pending = tile;
        b.reveal(&mut Rng::from_vrf(randomness))
    }

    #[test]
    fn binomials_are_exact() {
        assert_eq!(choose(25, 0), 1);
        assert_eq!(choose(25, 1), 25);
        assert_eq!(choose(25, 12), 5_200_300);
        assert_eq!(choose(25, 25), 1);
        assert_eq!(choose(24, 25), 0);
    }

    #[test]
    fn multipliers_follow_the_published_table() {
        // 1 mine, 1 tile: 0.99 × 25/24 = 1.03125.
        assert_eq!(gross_uncapped(100_000, 1, 1), 103_125);
        // 24 mines, 1 tile: 0.99 × 25 = 24.75.
        assert_eq!(gross_uncapped(100_000, 24, 1), 2_475_000);
        // 1 mine, every safe tile: 0.99 × 25 = 24.75.
        assert_eq!(gross_uncapped(100_000, 1, 24), 2_475_000);
        // 3 mines, 2 tiles: 0.99 × 300/231.
        assert_eq!(gross_uncapped(1_000_000, 3, 2), 1_285_714);
        // 0 tiles returns 0.99 of the stake (never paid: cash-out needs a tile).
        assert_eq!(gross_uncapped(100, 5, 0), 99);
    }

    #[test]
    fn gross_rounds_down_in_u128_without_overflow() {
        // 106 × 99 × 25 / 2 400 = 109.31…
        assert_eq!(gross_uncapped(106, 1, 1), 109);
        // The largest multiplier (12 mines, 13 tiles) on the largest stake does not overflow.
        let huge = gross_uncapped(u64::MAX, 12, 13);
        assert_eq!(huge, u64::MAX as u128 * 99 * 5_200_300 / 100);
        assert_eq!(max_gain(u64::MAX, 12, u64::MAX), u64::MAX);
    }

    #[test]
    fn max_gain_is_every_safe_tile_within_the_round_limit() {
        // 24 mines: one safe tile, 24.75x.
        assert_eq!(max_gain(1_000, 24, 1_000_000), 23_750);
        assert_eq!(max_gain(1_000, 24, 10_000), 10_000);
        // 12 mines can reach 5 148 297x: always the round limit.
        assert_eq!(max_gain(1_000, 12, 50_000), 50_000);
    }

    #[test]
    fn a_safe_reveal_goes_back_to_the_player() {
        let mut b = board(1_000, 3, 1_000_000);
        assert_eq!(reveal(&mut b, 7, randomness_for(3, 0, false)), None);
        assert_eq!((b.n_revealed, b.pending, b.busted), (1, NONE, NONE));
        assert!(b.is_revealed(7) && !b.can_reveal(7));
        assert_eq!(b.revealed_tiles(), &[7]);
        assert!(b.can_cash_out());
        assert_eq!(b.gross(), gross_uncapped(1_000, 3, 1) as u64);
    }

    #[test]
    fn a_mine_busts_the_round() {
        let mut b = board(1_000, 3, 1_000_000);
        assert_eq!(reveal(&mut b, 12, randomness_for(3, 0, true)), Some(0));
        assert_eq!((b.busted, b.pending, b.n_revealed), (12, NONE, 0));
        assert!(!b.is_revealed(12));
    }

    #[test]
    fn the_last_safe_tile_cashes_out() {
        let mut b = board(1_000, 24, 1_000_000);
        // 24 mines leave one safe tile: revealing it clears the board.
        let gross = reveal(&mut b, 0, randomness_for(24, 0, false));
        assert_eq!(gross, Some(24_750));
        assert_eq!(b.n_revealed, 1);
    }

    #[test]
    fn reaching_the_cap_cashes_out_at_the_cap() {
        // 1 000 on 12 mines, round limit 2 000: capped at 3 000 gross well before the board clears.
        let mut b = board(1_000, 12, 2_000);
        let mut tile = 0;
        let gross = loop {
            let seed = randomness_for(12, b.n_revealed, false);
            if let Some(gross) = reveal(&mut b, tile, seed) {
                break gross;
            }
            tile += 1;
        };
        assert_eq!(gross, 3_000);
        assert!(b.n_revealed < TILES - 12);
        assert!(gross_uncapped(1_000, 12, b.n_revealed) >= 3_000);
        assert!(gross_uncapped(1_000, 12, b.n_revealed - 1) < 3_000);
    }

    #[test]
    fn refused_moves() {
        let mut b = board(1_000, 3, 1_000_000);
        assert!(!b.can_cash_out(), "nothing revealed");
        assert!(!b.can_reveal(TILES), "off the board");
        assert!(!b.can_reveal(NONE));
        b.pending = 4;
        assert!(!b.can_reveal(5), "a reveal is pending");
        b.pending = NONE;
        reveal(&mut b, 4, randomness_for(3, 0, false));
        assert!(!b.can_reveal(4), "already revealed");
        b.pending = 5;
        assert!(!b.can_cash_out(), "a reveal is pending");
    }

    #[test]
    fn a_new_round_resets_the_board_but_keeps_the_player() {
        let mut b = board(1_000, 3, 1_000_000);
        b.player = Pubkey::new_unique();
        reveal(&mut b, 4, randomness_for(3, 0, true));
        let player = b.player;
        b.start(500, 5, 7);
        assert_eq!(
            b,
            MinesBoard {
                player,
                bet: 500,
                mines: 5,
                max_gain: 7,
                ..MinesBoard::default()
            }
        );
    }

    #[test]
    fn a_reveal_is_a_mine_as_often_as_on_a_random_layout() {
        // With k = 20 revealed and 3 mines, 3 of the 5 hidden tiles are mines: 60%.
        let mut rng = Rng::from_vrf([9; 32]);
        let n = 100_000;
        let mines = (0..n).filter(|_| is_mine(&mut rng, 3, 20)).count();
        // Expected 60 000; 5 sigma is about 775.
        assert!((59_200..=60_800).contains(&mines), "{mines}");
    }

    #[test]
    fn rtp_is_99_percent_at_every_cash_out_point() {
        // P(k safe) = C(25 - m, k) / C(25, k), so mult × P = 0.99 exactly.
        for mines in 1..=MAX_MINES {
            for k in 1..=TILES - mines {
                let p_num = choose(TILES - mines, k);
                let p_den = choose(TILES, k);
                let stake = 1_000_000_000u64;
                let ev = gross_uncapped(stake, mines, k) * p_num / p_den;
                // Rounding down twice loses at most a couple of units per 10^9.
                let expected = 990_000_000u128;
                assert!(expected - ev <= 2, "mines {mines} k {k}: {ev}");
            }
        }
    }

    #[test]
    fn board_layout_is_fixed() {
        // Delegated accounts cannot be resized: changing this needs a new seed.
        assert_eq!(MinesBoard::INIT_SPACE, 81);
    }
}
