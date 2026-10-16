// Generator of rust-vectors.json: draws computed by the program's own Rust code.
// Regenerate: copy chain/programs/tilt/src/{rng,settlement}.rs and games/{mod,blackjack,baccarat,roulette,slots,mines,
// dice,limbo,flip,keno,wheel,hilo,tower}.rs next to this file (src/ and src/games/, keeping in games/mod.rs only the
// helpers and the `pub mod` lines of those games), strip the anchor derives, `#[account]` and the test
// modules, replace `use anchor_lang::prelude::*;` with `type Pubkey = [u8; 32];`, then
// `rustc --edition 2021 -O main.rs && ./main > rust-vectors.json` (and prettier the JSON).
mod rng;
mod settlement;
mod games;
use games::{baccarat::*, blackjack::*, roulette::*, slots::*};
use games::{dice, flip::{self, CoinSide}, keno, limbo, wheel::{self, WheelRisk}};
use games::hilo::{HiloBoard, HiloMove};
use games::mines::{self, MinesBoard};
use games::tower::{self, TowerBoard, TowerDifficulty};
use rng::Rng;

fn seed(i: u64) -> [u8; 32] { let mut s = [0u8; 32]; s[..8].copy_from_slice(&i.to_le_bytes()); s[31] = (i % 251) as u8; s }
fn hex(s: &[u8; 32]) -> String { s.iter().map(|b| format!("{:02x}", b)).collect() }
fn list(v: &[u8]) -> String { format!("[{}]", v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",")) }

fn main() {
    let mut out = Vec::new();
    // rng
    let mut rngs = Vec::new();
    for s in [[0u8; 32], [7u8; 32], [42u8; 32], [255u8; 32], seed(123456789)] {
        let mut r = Rng::from_vrf(s);
        let below37: Vec<String> = (0..6).map(|_| r.below(37).to_string()).collect();
        let cards: Vec<String> = (0..6).map(|_| r.card().to_string()).collect();
        let below41: Vec<String> = (0..6).map(|_| r.below(41).to_string()).collect();
        rngs.push(format!("{{\"seed\":\"{}\",\"below37\":[{}],\"cards\":[{}],\"below41\":[{}]}}", hex(&s), below37.join(","), cards.join(","), below41.join(",")));
    }
    out.push(format!("\"rng\":[{}]", rngs.join(",")));
    // blackjack: 1 to 6 dealt hands; draws are seeds, in the order the program requests them. A
    // stand that leaves a hand to play takes no draw; the last stand is followed by the dealer's
    // draw. Pairs are mostly split (re-splits included) so the split rules get covered.
    let mut bj = Vec::new();
    for i in 0..240u64 {
        let n_hands = (1 + i % MAX_HANDS as u64) as u8;
        let mut t = BlackjackTable::default();
        t.start(1_000_000, n_hands);
        let mut draws = vec![hex(&seed(i))];
        let mut actions: Vec<&str> = vec!["deal"];
        let mut done = t.deal(&mut Rng::from_vrf(seed(i)));
        let mut k = 1u64;
        while !done {
            let s = seed(i * 1000 + k);
            let choice = (i + k) % 5;
            k += 1;
            let hand = *t.active_hand().unwrap();
            if choice != 4 && t.can_split() { draws.push(hex(&s)); actions.push("split"); done = t.split(&mut Rng::from_vrf(s)); }
            else if choice == 0 && hand.can_double() { draws.push(hex(&s)); actions.push("double"); done = t.double(&mut Rng::from_vrf(s)); }
            else if choice == 1 && hand.can_hit() { draws.push(hex(&s)); actions.push("hit"); done = t.hit(&mut Rng::from_vrf(s)); }
            else if choice == 2 && hand.can_hit() && hand.total() < 15 { draws.push(hex(&s)); actions.push("hit"); done = t.hit(&mut Rng::from_vrf(s)); }
            else {
                actions.push("stand");
                if t.stand() { draws.push(hex(&s)); actions.push("dealer"); t.play_dealer(&mut Rng::from_vrf(s)); done = true; }
            }
        }
        let stake = t.stake();
        let st = settlement::settle(stake, t.gross());
        let hands: Vec<String> = t.hands().iter().map(|h| format!("{{\"cards\":{},\"doubled\":{},\"split\":{}}}", list(h.cards()), h.doubled, h.split)).collect();
        bj.push(format!("{{\"draws\":[{}],\"actions\":[{}],\"bet\":\"{}\",\"stake\":\"{}\",\"hands\":[{}],\"active\":{},\"dealer\":{},\"splits\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.iter().map(|d| format!("\"{}\"", d)).collect::<Vec<_>>().join(","),
            actions.iter().map(|a| format!("\"{}\"", a)).collect::<Vec<_>>().join(","),
            t.bet, stake, hands.join(","), t.active, list(t.dealer_cards()), t.splits, t.gross(), st.payout, st.fee));
    }
    out.push(format!("\"blackjack\":[{}]", bj.join(",")));
    let mut bac = Vec::new();
    for i in 0..60u64 {
        let mut c = BaccaratCoup::new(BaccaratBet::Player);
        c.deal(&mut Rng::from_vrf(seed(i)));
        let g: Vec<String> = [BaccaratBet::Player, BaccaratBet::Banker, BaccaratBet::Tie].iter().map(|b| { let mut x = c; x.bet = *b; x.gross(1_000_000).to_string() }).collect();
        bac.push(format!("{{\"seed\":\"{}\",\"player\":{},\"banker\":{},\"gross\":[{}]}}", hex(&seed(i)), list(&c.player), list(&c.banker), g.join(",")));
    }
    out.push(format!("\"baccarat\":[{}]", bac.join(",")));
    let mut rou = Vec::new();
    for i in 0..60u64 {
        let mut s = RouletteSpin { bet: RouletteBet::Red, number: 0 };
        s.spin(&mut Rng::from_vrf(seed(i)));
        let mut st = RouletteSpin { bet: RouletteBet::Straight(17), number: s.number };
        let red = s.gross(1_000_000); let straight = { st.number = s.number; st.gross(1_000_000) };
        rou.push(format!("{{\"seed\":\"{}\",\"number\":{},\"red\":\"{}\",\"straight17\":\"{}\"}}", hex(&seed(i)), s.number, red, straight));
    }
    out.push(format!("\"roulette\":[{}]", rou.join(",")));
    let mut sl = Vec::new();
    for i in 0..200u64 {
        let mut s = SlotsSpin::default();
        s.spin(&mut Rng::from_vrf(seed(i)));
        sl.push(format!("{{\"seed\":\"{}\",\"reels\":{},\"gross\":\"{}\"}}", hex(&seed(i)), list(&s.reels), s.gross(1_000_000)));
    }
    out.push(format!("\"slots\":[{}]", sl.join(",")));
    // mines: the gross of every (mines, safe tiles) for 1 USDC, then rounds revealing tiles one
    // draw each until a mine, the cleared board or the cap, else cashed out after `stop` tiles.
    // Every fourth round has a 3 USDC round limit so the cap gets hit.
    let gross_table: Vec<String> = (1..=mines::MAX_MINES)
        .map(|m| format!("[{}]", (0..=mines::TILES - m).map(|k| format!("\"{}\"", mines::gross_uncapped(1_000_000, m, k))).collect::<Vec<_>>().join(",")))
        .collect();
    out.push(format!("\"minesGross\":[{}]", gross_table.join(",")));
    let mut mi = Vec::new();
    for i in 0..150u64 {
        // Half the rounds on 1 to 5 mines, so that some go on for many tiles.
        let n_mines = (if i % 2 == 0 { 1 + (i / 2) % 5 } else { 1 + i % mines::MAX_MINES as u64 }) as u8;
        let stake = 1_000_000u64;
        let limit = if i % 4 == 3 { 3_000_000 } else { 1_000_000_000_000 };
        let mut b = MinesBoard::default();
        b.start(stake, n_mines, mines::max_gain(stake, n_mines, limit));
        let stop = 1 + (i / 3) % 12;
        let mut draws = Vec::new();
        let mut ended = None;
        let mut j = 0u64;
        while ended.is_none() && (b.n_revealed as u64) < stop {
            let tile = (0..25u64).map(|d| ((i * 7 + j * 11 + d) % 25) as u8).find(|&t| b.can_reveal(t)).unwrap();
            let s = seed(i * 1000 + j);
            j += 1;
            b.pending = tile;
            draws.push(format!("\"{}\"", hex(&s)));
            ended = b.reveal(&mut Rng::from_vrf(s));
        }
        let cashout = ended.is_none();
        let gross = ended.unwrap_or_else(|| b.gross());
        let st = settlement::settle(stake, gross);
        let busted = if b.busted == mines::NONE { "null".to_string() } else { b.busted.to_string() };
        mi.push(format!("{{\"draws\":[{}],\"mines\":{},\"maxGain\":\"{}\",\"order\":{},\"busted\":{},\"cashout\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.join(","), n_mines, b.max_gain, list(b.revealed_tiles()), busted, cashout, gross, st.payout, st.fee));
    }
    out.push(format!("\"mines\":[{}]", mi.join(",")));
    // One-shot games (1 USDC, seeds from 10 000 up): one draw each, its result and gross.
    // dice: winning counts across 1%..98% (both ends included), alternately under and over.
    let mut di = Vec::new();
    for i in 0..200u64 {
        let over = i % 2 == 1;
        let winning = (dice::MIN_WINNING as u64 + (i * 397) % (dice::MAX_WINNING - dice::MIN_WINNING + 1) as u64) as u16;
        let winning = if i == 199 { dice::MAX_WINNING } else { winning };
        let target = if over { dice::ROLLS - winning } else { winning };
        let s = seed(10_000 + i);
        let roll = dice::roll(&mut Rng::from_vrf(s));
        di.push(format!("{{\"seed\":\"{}\",\"target\":{},\"over\":{},\"roll\":{},\"gross\":\"{}\"}}",
            hex(&s), target, over, roll, dice::gross(1_000_000, target, over, roll)));
    }
    out.push(format!("\"dice\":[{}]", di.join(",")));
    // limbo: targets from 1.01x to 10 000x.
    let targets = [101u32, 150, 196, 200, 250, 500, 1_000, 10_000, 100_000, 1_000_000];
    let mut li = Vec::new();
    for i in 0..200u64 {
        let target = targets[i as usize % targets.len()];
        let s = seed(11_000 + i);
        let result = limbo::result(&mut Rng::from_vrf(s));
        li.push(format!("{{\"seed\":\"{}\",\"target\":{},\"result\":{},\"gross\":\"{}\"}}",
            hex(&s), target, result, limbo::gross(1_000_000, target, result)));
    }
    out.push(format!("\"limbo\":[{}]", li.join(",")));
    // flip: 1 to 10 coins (mostly few, so that some win), heads and tails; `coins` bit i = coin i tails.
    let mut fl = Vec::new();
    for i in 0..200u64 {
        let flips = (if i % 2 == 0 { 1 + (i / 2) % 3 } else { 1 + i % flip::MAX_FLIPS as u64 }) as u8;
        let side = if i % 3 == 0 { CoinSide::Tails } else { CoinSide::Heads };
        let s = seed(12_000 + i);
        let coins = flip::toss(&mut Rng::from_vrf(s), flips);
        fl.push(format!("{{\"seed\":\"{}\",\"flips\":{},\"side\":\"{}\",\"coins\":{},\"gross\":\"{}\"}}",
            hex(&s), flips, if side == CoinSide::Heads { "heads" } else { "tails" }, coins, flip::gross(1_000_000, side, flips, coins)));
    }
    out.push(format!("\"flip\":[{}]", fl.join(",")));
    // keno: the pay tables, then 1 to 10 distinct picks (13 is prime with 40).
    let tables: Vec<String> = keno::PAYTABLES.iter().map(|t| format!("[{}]", t.iter().map(|m| format!("\"{}\"", m)).collect::<Vec<_>>().join(","))).collect();
    out.push(format!("\"kenoPaytables\":[{}]", tables.join(",")));
    let mut ke = Vec::new();
    for i in 0..200u64 {
        let n = 1 + (i % keno::MAX_PICKS as u64);
        let picks: Vec<u8> = (0..n).map(|k| ((i * 7 + k * 13) % keno::NUMBERS as u64) as u8 + 1).collect();
        let s = seed(13_000 + i);
        let drawn = keno::draw(&mut Rng::from_vrf(s));
        let hits = keno::hits(&picks, &drawn);
        ke.push(format!("{{\"seed\":\"{}\",\"picks\":{},\"drawn\":{},\"hits\":{},\"gross\":\"{}\"}}",
            hex(&s), list(&picks), list(&drawn), hits, keno::gross(1_000_000, picks.len(), hits)));
    }
    out.push(format!("\"keno\":[{}]", ke.join(",")));
    // wheel: every wheel's multipliers, then spins over every (risk, segments).
    let risks = [(WheelRisk::Low, "low"), (WheelRisk::Medium, "medium"), (WheelRisk::High, "high")];
    let mut wt = Vec::new();
    for (risk, name) in risks {
        for segments in wheel::SEGMENTS {
            let m: Vec<String> = wheel::multipliers(risk, segments).map(|x| format!("\"{}\"", x)).collect();
            wt.push(format!("{{\"risk\":\"{}\",\"segments\":{},\"multipliers\":[{}]}}", name, segments, m.join(",")));
        }
    }
    out.push(format!("\"wheelTables\":[{}]", wt.join(",")));
    let mut wh = Vec::new();
    for i in 0..150u64 {
        let (risk, name) = risks[(i / 5) as usize % risks.len()];
        let segments = wheel::SEGMENTS[i as usize % wheel::SEGMENTS.len()];
        let s = seed(14_000 + i);
        let segment = wheel::spin(&mut Rng::from_vrf(s), segments);
        wh.push(format!("{{\"seed\":\"{}\",\"risk\":\"{}\",\"segments\":{},\"segment\":{},\"gross\":\"{}\"}}",
            hex(&s), name, segments, segment, wheel::gross(1_000_000, risk, segments, segment)));
    }
    out.push(format!("\"wheel\":[{}]", wh.join(",")));
    // hilo: the first card, then guesses (mostly the likelier side, some the other, some skips)
    // until a wrong guess, the cap or the board, else cashed out after `stop` right guesses.
    // max_gain is the round limit; every fourth round has a 3 USDC one so the cap gets hit.
    let mut hi = Vec::new();
    for i in 0..150u64 {
        let stake = 1_000_000u64;
        let limit = if i % 4 == 3 { 3_000_000 } else { 1_000_000_000_000 };
        let mut b = HiloBoard::default();
        b.start(stake, limit);
        let stop = 1 + (i / 3) % 6;
        let s = seed(15_000 + i * 100);
        let mut draws = vec![format!("\"{}\"", hex(&s))];
        let mut ended = b.draw(&mut Rng::from_vrf(s));
        let mut j = 1u64;
        while ended.is_none() && (b.n_right as u64) < stop {
            let r = b.current_rank().unwrap();
            let likely = if b.can_guess(HiloMove::Higher) && (r <= 7 || !b.can_guess(HiloMove::Lower)) { HiloMove::Higher } else { HiloMove::Lower };
            let other = if likely == HiloMove::Higher { HiloMove::Lower } else { HiloMove::Higher };
            let guess = if i % 5 == 0 && j % 3 == 1 && b.can_guess(HiloMove::Skip) { HiloMove::Skip }
                else if (i + j) % 9 == 0 && b.can_guess(other) { other } else { likely };
            let s = seed(15_000 + i * 100 + j);
            j += 1;
            b.pending = guess.code();
            draws.push(format!("\"{}\"", hex(&s)));
            ended = b.draw(&mut Rng::from_vrf(s));
        }
        let cashout = ended.is_none();
        let gross = ended.unwrap_or_else(|| b.gross());
        let st = settlement::settle(stake, gross);
        let n = b.n_cards as usize;
        hi.push(format!("{{\"draws\":[{}],\"maxGain\":\"{}\",\"cards\":{},\"guesses\":{},\"fair\":\"{}\",\"busted\":{},\"cashout\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.join(","), b.max_gain, list(&b.cards[..n]), list(&b.guesses[..n - 1]), b.fair, b.busted, cashout, gross, st.payout, st.fee));
    }
    out.push(format!("\"hilo\":[{}]", hi.join(",")));
    // tower: every difficulty, climbing tiles one draw each until a bad tile, the top or the
    // cap, else cashed out after `stop` levels. Every fourth round has a 3 USDC round limit.
    let difficulties = [(TowerDifficulty::Easy, "easy"), (TowerDifficulty::Medium, "medium"), (TowerDifficulty::Hard, "hard"), (TowerDifficulty::Expert, "expert"), (TowerDifficulty::Master, "master")];
    let mut to = Vec::new();
    for i in 0..150u64 {
        let (difficulty, name) = difficulties[i as usize % difficulties.len()];
        let stake = 1_000_000u64;
        let limit = if i % 4 == 3 { 3_000_000 } else { 1_000_000_000_000 };
        let mut b = TowerBoard::default();
        b.start(stake, difficulty, tower::max_gain(stake, difficulty, limit));
        let stop = 1 + (i / 5) % tower::LEVELS as u64;
        let mut draws = Vec::new();
        let mut ended = None;
        let mut j = 0u64;
        while ended.is_none() && (b.level as u64) < stop {
            let tile = ((i + j) % difficulty.tiles() as u64) as u8;
            let s = seed(16_000 + i * 100 + j);
            j += 1;
            b.pending = tile;
            draws.push(format!("\"{}\"", hex(&s)));
            ended = b.climb(&mut Rng::from_vrf(s));
        }
        let cashout = ended.is_none();
        let gross = ended.unwrap_or_else(|| b.gross());
        let st = settlement::settle(stake, gross);
        let busted = if b.busted == tower::NONE { "null".to_string() } else { b.busted.to_string() };
        to.push(format!("{{\"draws\":[{}],\"difficulty\":\"{}\",\"maxGain\":\"{}\",\"climbed\":{},\"busted\":{},\"cashout\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.join(","), name, b.max_gain, list(&b.climbed[..b.level as usize]), busted, cashout, gross, st.payout, st.fee));
    }
    out.push(format!("\"tower\":[{}]", to.join(",")));
    println!("{{{}}}", out.join(","));
}
