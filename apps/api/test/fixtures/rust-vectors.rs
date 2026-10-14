// Generator of rust-vectors.json: draws computed by the program's own Rust code.
// Regenerate: copy chain/programs/tilt/src/{rng,settlement}.rs and games/{blackjack,baccarat,roulette,slots}.rs
// next to this file (src/ and src/games/), strip the anchor derives, `#[account]` and the test
// modules, replace `use anchor_lang::prelude::*;` with `type Pubkey = [u8; 32];`, then
// `rustc --edition 2021 -O main.rs && ./main > rust-vectors.json` (and prettier the JSON).
mod rng;
mod settlement;
mod games { pub mod baccarat; pub mod blackjack; pub mod roulette; pub mod slots; }
use games::{baccarat::*, blackjack::*, roulette::*, slots::*};
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
    // blackjack: 1 to 6 hands; draws are seeds, in the order the program requests them. A stand
    // that leaves a hand to play takes no draw; the last stand is followed by the dealer's draw.
    let mut bj = Vec::new();
    for i in 0..120u64 {
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
            if choice == 0 && hand.can_double() { draws.push(hex(&s)); actions.push("double"); done = t.double(&mut Rng::from_vrf(s)); }
            else if choice == 1 && hand.can_hit() { draws.push(hex(&s)); actions.push("hit"); done = t.hit(&mut Rng::from_vrf(s)); }
            else if choice == 2 && hand.can_hit() && hand.total() < 15 { draws.push(hex(&s)); actions.push("hit"); done = t.hit(&mut Rng::from_vrf(s)); }
            else {
                actions.push("stand");
                if t.stand() { draws.push(hex(&s)); actions.push("dealer"); t.play_dealer(&mut Rng::from_vrf(s)); done = true; }
            }
        }
        let stake = t.stake();
        let st = settlement::settle(stake, t.gross());
        let hands: Vec<String> = t.hands().iter().map(|h| format!("{{\"cards\":{},\"doubled\":{}}}", list(h.cards()), h.doubled)).collect();
        bj.push(format!("{{\"draws\":[{}],\"actions\":[{}],\"bet\":\"{}\",\"stake\":\"{}\",\"hands\":[{}],\"active\":{},\"dealer\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.iter().map(|d| format!("\"{}\"", d)).collect::<Vec<_>>().join(","),
            actions.iter().map(|a| format!("\"{}\"", a)).collect::<Vec<_>>().join(","),
            t.bet, stake, hands.join(","), t.active, list(t.dealer_cards()), t.gross(), st.payout, st.fee));
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
    println!("{{{}}}", out.join(","));
}
