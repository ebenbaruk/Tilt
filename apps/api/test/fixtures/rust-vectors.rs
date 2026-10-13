// Generator of rust-vectors.json: draws computed by the program's own Rust code.
// Regenerate: copy chain/programs/tilt/src/{rng,settlement}.rs and games/{blackjack,baccarat,roulette,slots}.rs
// next to this file (src/ and src/games/), strip the anchor derives and `use anchor_lang`, then
// `rustc --edition 2021 -O main.rs && ./main > rust-vectors.json`.
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
    // blackjack: draws are seeds; actions after the deal
    let mut bj = Vec::new();
    for i in 0..60u64 {
        let base = 1_000_000u64;
        let mut h = BlackjackHand::default();
        let mut draws = vec![hex(&seed(i))];
        let mut actions: Vec<&str> = vec!["deal"];
        let mut stake = base;
        let mut done = h.deal(&mut Rng::from_vrf(seed(i)));
        let mut k = 1u64;
        while !done {
            let s = seed(i * 1000 + k); k += 1;
            draws.push(hex(&s));
            let choice = (i + k) % 4;
            if choice == 0 && h.can_double() { actions.push("double"); stake *= 2; h.double(&mut Rng::from_vrf(s)); done = true; }
            else if choice == 1 && h.can_hit() { actions.push("hit"); done = h.hit(&mut Rng::from_vrf(s)); }
            else if choice == 2 && h.can_hit() && h.player_total() < 15 { actions.push("hit"); done = h.hit(&mut Rng::from_vrf(s)); }
            else { actions.push("stand"); h.stand(&mut Rng::from_vrf(s)); done = true; }
        }
        let st = settlement::settle(stake, h.gross(stake));
        bj.push(format!("{{\"draws\":[{}],\"actions\":[{}],\"stake\":\"{}\",\"player\":{},\"dealer\":{},\"doubled\":{},\"gross\":\"{}\",\"payout\":\"{}\",\"fee\":\"{}\"}}",
            draws.iter().map(|d| format!("\"{}\"", d)).collect::<Vec<_>>().join(","),
            actions.iter().map(|a| format!("\"{}\"", a)).collect::<Vec<_>>().join(","),
            stake, list(h.player_cards()), list(h.dealer_cards()), h.doubled, h.gross(stake), st.payout, st.fee));
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
