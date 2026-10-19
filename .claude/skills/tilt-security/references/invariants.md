# Tilt invariants (INV-xx)
**How to read this file: it is over the Read tool's default cap. Read lines 1-145 first (rules, goal map, Index). Then get a line map with `grep -n "^## \|^### INV-" .claude/skills/tilt-security/references/invariants.md` and Read each entry you need with `offset`/`limit` (from its heading to the next one). §K equations, §L PR triage and §M test backlog are at the end (`grep -n "^## [KLM]\."`).**

Reference for audit agents. Every finding names the invariant it breaks (`invariant: "INV-xx"`) or states a new one in the canonical form below.
Pointers were checked at `d559a31` (2026-10-19). **Code moves: re-read every file:line at the target commit before you rely on it.** A pointer that no longer matches is a lead to re-verify, not proof.

Paths: `C/` = `chain/programs/tilt/src/`, `W/` = `apps/wallet/src/`, `A/` = `apps/api/src/`. Prior audit = `docs/audits/2026-10-13-chain-relay.md` (ids F*, L*, I*, and its "Modèle de confiance" section).

## How to use this file

- **checklist lens**: for each invariant in scope, confirm the enforcement point still exists at HEAD and that no new code path bypasses it (new instruction, route, job, CLI command).
- **invariant-breaker lens**: pick the invariants in scope and look for any sequence of calls (any order, interleaving or actor in the threat model) that ends in a state violating them. Start with entries whose `Second barrier` is `none`, then GAP / PARTIAL / OK-untested.
- **attacker-goal lens** (and red team): pick your goal in the table below, then find the **cheapest** invariant on its list that has no second barrier. Name every invariant your chain breaks, in order.
- **diff lens (PR)**: list the invariants whose enforcement lines or second barriers the diff touches (§L), then re-prove each one.
- A "second barrier" is an independent check in another layer (spec §10.1, defence in depth). `Second barrier: none` is stated explicitly. An invariant with no second barrier and one hot key in front of it is a priority target.

Rules for reporting (hunters, refuters, critics):
1. **Listed leads are not findings.** To report a GAP/PARTIAL lead from this file, do your own trace at HEAD with concrete inputs. Cite it as `INV-xx` and add only what is new: reachability, a cheaper path, a larger impact, or a PoC. A restatement of the entry is a duplicate.
2. **`OK` is the author's claim at `d559a31`, not evidence.** Spend at least half your effort on paths this file does not list; unlisted violations are the main prize.
3. **Refuters: never refute a finding because this file says OK.** Refute only from code. KNOWN items are refuted as duplicates only if the finding adds nothing beyond the prior audit.
4. **New invariant format:** `NEW: <layer>: <one-sentence statement>` (layer = chain | rollup-vrf | relay | contract | api | web | mod | supply-chain | ops | cross-layer). Do not invent INV numbers; the report writer or the coverage critic assigns the next free number (the last used is INV-68).
5. Rules of engagement apply (SKILL.md): local stack only for anything that sends a transaction, devnet read-only, never read `.env*` or `PRIVY_*` values, never edit the other founder's zone. Entries marked **HUMAN-ONLY** are not run by agents.

### Attacker goal → invariants that must fall

| Goal | Invariants (look for the cheapest one without a second barrier) |
|---|---|
| Drain the vault | INV-01, 02, 03, 05, 06, 13, 15, 32, 41, 61, 66, 67 |
| Leave with more USDC than deposited (player, 50 USDC) | INV-11, 18, 19, 26, 27, 28, 30, 21, 51 |
| Drain the fee payer / relayer escrow | INV-65, 22, 50, 66 |
| Drain the prize or promo pool | INV-14, 38, 48, 51, 52, 66 |
| Steal another player's balance | INV-37, 39, 45, 47, 54, 58 |
| Free re-roll / selective abort | INV-25, 26, 27, 28, 29, 16 |
| Take over an account or session | INV-37, 45, 54, 56, 58 |
| Own a developer machine through the mod, repo or CI | INV-58, 59, 64 |
| Insider (one component compromised) | INV-66 first, then the goal row above that matches what the key reaches |

### Status legend

Index statuses start with the **worst** sub-status as one token, so `grep -E "\| (GAP|PARTIAL|TRUST|KNOWN|OK-untested)"` catches every split entry.

| Status | Meaning |
|---|---|
| OK | Enforced in code and covered by at least one named test. Still re-verify. |
| OK-untested | Enforced in code; no test exercises the violation. Write the test. |
| PARTIAL | Enforced, with a known hole or bypass listed in the entry. |
| GAP | Not enforced, or violated at HEAD. A lead to verify and PoC, not a confirmed finding. |
| TRUST | Holds only if an external party behaves (MagicBlock validator/oracle, Privy, RPC, Circle, operator). Measure the blast radius if it does not. |
| KNOWN | Accepted open item from the prior audit (finding id or "Modèle de confiance"). Do not report as new; re-verify it is still bounded as described. |

"If broken" (Index): **vault-wide** (the vault, or all players' funds) · **per-player capped** (bounded by one player's balance or allowance) · **pool-wide** (promo/prize pool, sponsor budget) · **liveness** (funds stuck, fee payer drained, service down) · **privacy** (data, secrets, dev machine).

### Test methods

| Tag | Tooling at HEAD | Where |
|---|---|---|
| unit | Rust `#[test]`; no proptest/quickcheck in `chain/Cargo.lock` | `cd chain && cargo +1.89.0 test` |
| prop-rs | **to add**: `proptest` dev-dependency over pure fns (`state.rs`, `withdrawals.rs`, `settlement.rs`, `games/*`) | `#[cfg(test)]` in `C/**` |
| svm | **to add**: LiteSVM / Mollusk with forged accounts (`set_account`) for the Anchor `Accounts` structs (no Rust test drives the handlers in `account.rs`, `admin.rs`, `table.rs`, `withdraw.rs`) | new `chain/programs/tilt/tests/` |
| e2e-chain | `chain/scripts/e2e.ts` on the LOCAL stack only (French `check(...)` labels) | `docs/dev.md` §2; never `--shared-vault` |
| vitest | api / relay suites on real Postgres (`TEST_DATABASE_URL`). **They skip silently when Postgres is down: look for "skipped".** | commands in `CLAUDE.md` |
| prop-ts | `fast-check` (devDependency of `apps/api` only) | `apps/api/test/{units,competitions,games}.test.ts` |
| race | N-way `Promise.all` on one route or intent against real Postgres | api or relay vitest |
| e2e-relay | `apps/wallet/test/relay.e2e.ts` (local stack) | `chain.yml` CI job |
| pw | Playwright; API mocked, Privy offline (no logged-in flow) | `apps/web/e2e/` |
| mod | `claude plugin test .` in `apps/mod` | `apps/mod/tests/` |
| sim | **to add**: a script or vitest simulation (sybils, EV, cost per attacker unit) | PoC worktree |

PoCs and regression tests are written by `sec-poc-engineer` in an isolated worktree. Fixes are proposed to the zone owner, never applied by an agent.

## Index

| ID | Invariant | Layer | If broken | Status |
|---|---|---|---|---|
| INV-01 | Vault solvency `vault_token.amount >= vault.reserved` | chain | vault-wide | OK-untested (sequences); per-site OK |
| INV-02 | Reservation identity `reserved == Σ(deposited − forfeited − withdrawn_paid + max_win)` | chain | vault-wide | OK-untested (multi-player) |
| INV-03 | Per-player allowance never negative (`checked_due` / `checked_forfeit`) | chain | vault-wide | OK |
| INV-04 | Ledger fields monotonic | chain | per-player capped | OK-untested |
| INV-05 | Settle-once: each committed claim pays at most once | chain + rollup | vault-wide | OK |
| INV-06 | Vault money leaves only to the player's own token account or the treasury | chain | vault-wide | OK |
| INV-07 | House withdraws only free funds | chain | vault-wide | OK (e2e) |
| INV-08 | Automatic payout caps; held money stays reserved | chain | vault-wide | KNOWN (2x at boundary, L5); else OK |
| INV-09 | Kill switches stop what they claim; no permanent trap | chain + ops | vault-wide | PARTIAL (KNOWN I2, L1 mechanism) |
| INV-10 | Stored config always passes `Config::validate` | chain | vault-wide | PARTIAL (no upper bounds) |
| INV-11 | Win cap: net win ≤ reserved `max_win`; reservation growth bounded | chain + rollup | vault-wide | GAP (raise ignores `max_player_win`/`max_win_multiple`); per-round OK |
| INV-12 | Deposits credited in the ER exactly once | rollup | per-player capped | OK |
| INV-13 | USDC conservation; token outflow only at listed sites | chain | vault-wide | OK-untested |
| INV-14 | Promo: one payment per payout id, within pool caps | chain | pool-wide | TRUST (destination); caps OK |
| INV-15 | Authority matrix per instruction | chain | vault-wide | GAP (`fund_*` × Privy, INV-41); else OK |
| INV-16 | No wrap, no reachable panic on accepted input | chain | liveness | PARTIAL |
| INV-17 | One round per player; stake taken before the draw request | rollup | per-player capped | OK |
| INV-18 | Round conservation and fee rules | rollup | per-player capped | OK |
| INV-19 | Per-round limits refused, never capped | rollup | per-player capped | KNOWN (double, I2); else OK |
| INV-20 | ER balance conservation over a player's life | rollup | per-player capped | OK-untested |
| INV-21 | Checkpoint releases only realized losses | rollup + chain | vault-wide | OK-untested |
| INV-22 | ER withdraw bounds and flush-before-commit | rollup | liveness | OK-untested |
| INV-23 | Delegated account layouts never change | rollup | vault-wide | PARTIAL (no `BlackjackTable` test) |
| INV-24 | Delegation pinned to `config.validator`, relayer-only | rollup | vault-wide | TRUST (validator); OK-untested |
| INV-25 | VRF callback authenticated by the scoped identity | VRF | vault-wide | OK-untested (negative) |
| INV-26 | Answer bound to its request (`request_id`, status, game) | VRF | per-player capped | OK |
| INV-27 | No re-roll / selective abort (incl. the automatic sweeper re-request) | VRF + relay | vault-wide | TRUST (oracle/sequencer); KNOWN (min timeout); lead X1 |
| INV-28 | Callbacks never fail as a function of randomness | VRF | vault-wide | OK-untested |
| INV-29 | No future outcome readable before it is locked | VRF | vault-wide | OK-untested (non-mines); mines OK |
| INV-30 | Unbiased sampling; gross RTP as documented | VRF + games | vault-wide | OK |
| INV-31 | Magic Action handlers callable only through the scheduled action | rollup→chain | per-player capped | TRUST (escrow signing); OK (e2e) |
| INV-32 | Committed rollup state is bounded by Solana truth | rollup→chain | per-player capped | OK |
| INV-33 | Failures leave money owed, never lost or double-paid | rollup→chain | liveness | TRUST (MagicBlock, Circle); KNOWN (no escape hatch) |
| INV-34 | Relay: at most one execution per `intent_id`, replay bound to user + action | relay | per-player capped | OK |
| INV-35 | Relay: one non-promo intent in flight per player | relay | liveness | OK |
| INV-36 | Relay: record-before-send; landed never `failed`; status monotonic | relay | per-player capped | TRUST (RPC); else OK |
| INV-37 | Relay: money-in/out needs fresh consent of that player | relay | per-player capped | PARTIAL (KNOWN: relay key wagers) |
| INV-38 | Relay caps (deposit, promo) hold under concurrency | relay | pool-wide | OK |
| INV-39 | No request-supplied account in a relay tx; fee payer always the relayer | relay | per-player capped | OK-untested (fuzz) |
| INV-40 | Relay key = vault relayer; relay reachable only by the api with the key | relay + ops | vault-wide | PARTIAL |
| INV-41 | Relay Privy quorum can only sign what Tilt intends | relay + chain | vault-wide | GAP (HUMAN-ONLY live test) |
| INV-42 | Win-cap raise only for staking moves, exact shortfall | relay | vault-wide | OK |
| INV-43 | Amounts are canonical integer strings in [1, 2^64−1] everywhere | contract/api/web | vault-wide | OK |
| INV-44 | IDL and PDA helpers match the program | contract | vault-wide | OK |
| INV-45 | Session scope: mod token plays only; device code yields one session; token types not confusable | api | per-player capped | OK-untested (token-type/aud); else OK |
| INV-46 | The mod path can never carry a money action | api | per-player capped | OK |
| INV-47 | api intent id bound to (user, action); no IDOR | api | per-player capped | OK |
| INV-48 | Player intent ids cannot squat prize payout ids | api + relay | liveness | GAP |
| INV-49 | Responsible-gaming limits fail closed; withdrawals never blocked | api | per-player capped | PARTIAL |
| INV-50 | Every endpoint is rate limited by an unforgeable key | api/relay/web | liveness | PARTIAL (relay has none) |
| INV-51 | Prizes within pool/budget, eligible winners, paid once, only after approval | api | pool-wide | GAP (pay-time recheck); else OK |
| INV-52 | `indexed_through` means complete; draws decoded only from callbacks | api | pool-wide | GAP (truncated backfill) |
| INV-53 | No upstream/internal error text reaches a client | api/relay/mod | privacy | OK |
| INV-54 | Web delegates the wallet only to Tilt's quorum + policy | web | vault-wide | GAP |
| INV-55 | Web money flow: one id per unsettled request; unknown ≠ failed | web | per-player capped | OK |
| INV-56 | No script injection on the money origin (CSP, no sinks); waitlist formula-safe | web | per-player capped | PARTIAL; CSP OK |
| INV-57 | Client-side gates are UX only; server enforces | web/mod/api | per-player capped | OK-untested (as a matrix) |
| INV-58 | Mod token only goes to the trusted api origin | mod | per-player capped | PARTIAL |
| INV-59 | Mod never executes server-controlled content | mod | privacy | PARTIAL; escapes OK |
| INV-60 | Mod: one move in flight, resends reuse the id | mod | per-player capped | OK |
| INV-61 | Upgrade authority and admin under multisig before mainnet | ops | vault-wide | GAP (pre-mainnet blocker) |
| INV-62 | Kill switch always available in one command | ops | vault-wide | PARTIAL |
| INV-63 | Insolvency, drains and re-roll abuse are detected and stop money automatically | ops | vault-wide | GAP (automatic stop); detection PARTIAL |
| INV-64 | Supply chain: no unreviewed code reaches CI, players or the program | ops | vault-wide | PARTIAL |
| INV-65 | Relayer/escrow spend per attacker unit is bounded and costs the attacker at least as much | relay + chain | liveness | GAP (no relay limiter, no cost sim) |
| INV-66 | Per-key blast radius is bounded and has a second barrier | ops (insider) | vault-wide | PARTIAL |
| INV-67 | Every money movement has an idempotency key and an audit record | cross-layer | vault-wide | GAP (deposit on-chain, admin moves) |
| INV-68 | api SQL is parameterized; sponsor impressions are capped | api | pool-wide | OK-untested |

---

## A. Chain: Solana accounting (`vault`, `vault_token`, `Ledger`)

Money lives on Solana: `Vault` PDA `["vault"]`, USDC account `vault_token` PDA `["vault_token"]` (authority `vault`), one `Ledger` `["ledger", player]` per player, written only on Solana. The rollup never writes them; it sees read-only clones.

### INV-01 Vault solvency
**Statement.** After every Solana instruction: `vault_token.amount >= vault.reserved`. `reserved` is the worst case the vault may owe (doc `C/state.rs:94-96`).
- Enforced: every outflow is matched in `reserved` or gated on `free = vault_token.amount − reserved`: `withdraw_house` `C/instructions/admin.rs:130-131`; `pay_due` checks `vault_token.amount >= due` then `reserved -= due` (`C/withdrawals.rs:157-159`); `open_account` `free >= max_win` (`C/instructions/account.rs:71-72`); `raise_win_cap` `amount <= free` (`C/state.rs:124-145`, called from `account.rs:189-194`).
- Inflows raise `reserved` by exactly what they add for players: `open_account` `reserved += max_win + credited` (`account.rs:91`); `deposit` `reserved += amount` (`account.rs:169`). `fund_vault` adds tokens, not `reserved` (free bankroll).
- Second barrier: relay monitor `INSOLVENT` alert from on-chain state (`W/monitor.ts:41-43`); a log line only, no automatic pause (INV-63).
- Test: prop-rs / svm over random sequences of {open, deposit, raise, withdraw→pay, release, checkpoint→apply, withdraw_house, fund_vault}, asserting after each step. Include duplicated and reordered actions.
- Coverage: `raises_never_reserve_more_than_the_vault_holds` (`C/state.rs:686`, randomized, raises only); e2e free-bankroll check (`chain/scripts/e2e.ts:1208`). No sequence-level test.
- Status: OK-untested (globally).
- Break it by: a new token outflow not matched in `reserved`; a `reserved -=` larger than what was added for that player (INV-03); a transfer into a wrong account counted as paid; Token-2022 fees or transfer hooks if the mint type ever changes (today `Account<TokenAccount>` + `transfer_checked` on classic SPL).

### INV-02 Reservation identity
**Statement.** `vault.reserved == Σ_players (ledger.deposited − ledger.forfeited − ledger.withdrawn_paid + ledger.max_win)` after every Solana instruction. Promo is outside (`promo_token` is never reserved).
- Enforced by construction: each ledger field change has the same delta on `reserved`: `account.rs:91,94-95` (open), `:169-170` (deposit), `state.rs:124-145` (raise), `withdrawals.rs:158-159` (pay: `withdrawn_paid := claim.withdrawn`, `reserved -= due`, `due = claim.withdrawn − old withdrawn_paid`), `instructions/withdraw.rs:277-278` (apply_checkpoint: `forfeited := claim.forfeited`, `reserved -= released`).
- Second barrier: none on-chain (no global recompute); INV-01 is the safety net.
- Test: svm with ≥ 3 players and random interleavings; recompute Σ from every `Ledger` after each tx.
- Coverage: single-player check in e2e (`chain/scripts/e2e.ts:1222-1224`, "réserve de la trésorerie cohérente").
- Status: OK-untested (multi-player).
- Break it by: a path that writes a ledger field without the matching `reserved` delta (or the reverse), e.g. a held payment that still updates `withdrawn_paid`, or `release_withdrawals` on a ledger whose committed account belongs to another player.

### INV-03 Per-player allowance is never negative
**Statement.** For every player: `withdrawn_paid ≤ deposited − forfeited + max_win` and `forfeited ≤ deposited`; hence `reserved -= due` / `-= released` never underflows.
- Enforced: `checked_due` `C/withdrawals.rs:13-25` (`claim.player == ledger.player`, `claim.credited ≤ ledger.deposited`, `claim.withdrawn ≤ allowance` in u128); `checked_forfeit` `C/withdrawals.rs:187-196` (`claim.forfeited + withdrawn_paid ≤ deposited + max_win`, `claim.forfeited ≤ deposited`).
- Second barrier: `overflow-checks = true` (`chain/Cargo.toml:6`) makes a missed underflow revert instead of wrap.
- Test: prop-rs on `checked_due`/`checked_forfeit` with arbitrary claims and ledgers: whenever they return Ok, the post-state satisfies the inequality; pay then apply_checkpoint (and the reverse) never makes `deposited − forfeited − withdrawn_paid + max_win` negative.
- Coverage: `C/withdrawals.rs` tests `claim_withdrawing_more_than_deposits_plus_win_cap_is_refused`, `released_losses_shrink_the_allowance`, `forfeits_are_bounded_and_only_count_once`, `claim_for_another_player_is_refused`.
- Status: OK. Lead (verify): `checked_forfeit` does not check `claim.credited ≤ deposited`; confirm no ordering lets forfeits be released against deposits the ER has not credited yet.

### INV-04 Ledger fields are monotonic
**Statement.** `deposited`, `withdrawn_paid`, `forfeited`, `max_win` never decrease. `withdrawn_paid` is only set to a `claim.withdrawn` greater than itself (because `due > 0`).
- Enforced: only `+=` or assignment after `due > 0` / `released > 0` guards: `withdrawals.rs:131,158`, `instructions/withdraw.rs:274-278`. No instruction lowers `max_win` (by design, INV-11).
- Second barrier: none (INV-03 bounds the effect of a decrease on payouts).
- Test: prop-rs over the pure fns; svm asserting monotonicity after every instruction.
- Coverage: indirect only (`replayed_claim_pays_nothing`).
- Status: OK-untested.

### INV-05 Settle-once (withdrawals and checkpoints)
**Statement.** Replaying, duplicating or reordering the same committed `PlayerAccount` state through `pay_withdrawals`, `release_withdrawals` or `apply_checkpoint` moves money or releases reservation at most once. The idempotency key is the cumulative high-water mark (`claim.withdrawn` vs `ledger.withdrawn_paid`, `claim.forfeited` vs `ledger.forfeited`), never "pay X".
- Enforced: `due = claim.withdrawn.saturating_sub(withdrawn_paid)`, `due == 0 → Ok` (`C/withdrawals.rs:24,130-133`); `released == 0 → Ok` (`C/instructions/withdraw.rs:274-276`).
- Second barrier: none needed on-chain while the high-water mark holds; relay idempotency (INV-34) covers only the ER `withdraw` call, not the action.
- Test: svm: execute the same action 2..N times, and an older commit after a newer one (stale claim) ⇒ token delta only once, never negative.
- Coverage: `replayed_claim_pays_nothing`, `honest_claim_pays_only_the_unpaid_part` (`C/withdrawals.rs`). MagicBlock actions can be retried or run twice (validator issues #557 and #1706: https://github.com/magicblock-labs/magicblock-validator/issues/557, https://github.com/magicblock-labs/magicblock-validator/issues/1706; from research notes, verify current behaviour).
- Status: OK.
- Break it by: code that pays a per-call `amount` instead of the cumulative difference; a held payment that advances the mark; a path that lowers `withdrawn_paid`.

### INV-06 Vault money leaves only to the player's own token account or the treasury
**Statement.** Every `transfer_checked` out of `vault_token` goes either to a token account whose authority is `ledger.player` (withdrawals) or to `vault.treasury` (house withdrawals).
- Enforced: `PayWithdrawals.player_token` `token::authority = ledger.player` (`C/instructions/withdraw.rs:108`); same in `ReleaseWithdrawals` (`:160`); `withdraw_house` `has_one = treasury` (`C/instructions/admin.rs:116`). In the ER the forwarded accounts are `UncheckedAccount` (`instructions/withdraw.rs:37-44`), validated only on Solana.
- Second barrier: none (withdrawal addresses are never user input; the relay derives the ATA, INV-39).
- Test: svm negative matrix: substitute `player_token` (other owner, other mint, delegate set, closed or frozen), `vault_token`, `mint`, `token_program`.
- Coverage: e2e happy path only; no substitution test.
- Status: OK.
- Break it by: a player-owned token account with a `delegate`/`close_authority` set by someone else (the check is on `owner`; verify impact); a frozen player ATA making every action revert (liveness, INV-33).

### INV-07 The house withdraws only free funds
**Statement.** After `withdraw_house(x)`: `vault_token.amount >= reserved` (INV-01 holds), and only the admin can call it.
- Enforced: `C/instructions/admin.rs:110-131` (`has_one = admin`, `amount <= vault_token.amount.saturating_sub(reserved)`).
- Second barrier: none (single admin key until Squads, INV-61). No event, no off-chain record (INV-67).
- Test: svm property: any accepted `x` keeps INV-01; any `x > free` is refused.
- Coverage: e2e ("withdraw_house over the free amount").
- Status: OK.

### INV-08 Automatic payout caps; held money stays reserved
**Statement.** Automatic payments (`pay_withdrawals`) obey `!payouts_paused`, `due ≤ max_withdrawal`, per-player 24 h block `≤ player_daily_cap`, house money per 24 h block `≤ daily_cap`. Otherwise `WithdrawalHeld` is emitted, nothing moves, the ER debit stands and the amount stays reserved until a later commit or admin `release_withdrawals`.
- Enforced: `automatic_payment` `C/withdrawals.rs:59-82`; held branch `:145-153`; windows `Window::rolled` `:35-44`; `house_part` `:51-56`.
- KNOWN (prior audit "Fenêtres de 24 h fixes", L5): fixed blocks starting at `now` on roll ⇒ up to 2x a cap around a boundary, and the attacker controls when a block starts; `house_part` uses `ledger.forfeited`, not the claim's (L5). By design: `release_withdrawals` bypasses every cap and pause (`enforce_limits=false`, `C/instructions/withdraw.rs:169`), bounded only by `checked_due`.
- Second barrier: none for velocity (caps limit speed, not total).
- Test: prop-rs on `automatic_payment` sequences over time: Σ paid in any 24 h sliding window ≤ 2 × cap; Σ in one block ≤ cap.
- Coverage: `limits_hold_large_paused_or_over_cap_payments`, `only_money_beyond_the_players_deposits_counts_as_house_money`, `windows_reset_after_a_day`.
- Status: KNOWN (2x at boundary, L5).

### INV-09 Kill switches stop what they claim, and never trap funds forever
**Statement.** `deposits_paused` stops every USDC inflow from players; `bets_paused` stops every new stake; `payouts_paused` holds every automatic payment; `promo.paused` stops promo payouts. From any paused state there is a path that eventually pays every player what is owed.
- Enforced: deposits `C/instructions/account.rs:62` (open), `:152-155` (deposit); bets `check_can_start` `C/state.rs:426-433` and `raise_win_cap` `C/state.rs:131`; payouts `automatic_payment` `C/withdrawals.rs:67`; promo `promo_payment` `C/instructions/promo.rs:70`. Recovery: `release_withdrawals` (admin, ignores pauses) `C/instructions/withdraw.rs:169`.
- Holes: `blackjack_double` (`C/instructions/play.rs:215-228`) and `blackjack_split` (`:233-243`) do not check `bets_paused` (KNOWN I2: a doubled hand can stake 2x `max_bet`; the win cap stays covered). `bets_paused` reaches the ER only when the `Vault` clone refreshes (same mechanism as L1, which is about the old relayer key after a rotation). `withdraw` and `checkpoint` in the ER are allowed while bets are paused (by design). `fund_vault`/`fund_promo` ignore `deposits_paused` (no player credit, but see INV-41).
- Second barrier: none; relay and api have no pause of their own (api geo/exclusion only).
- Test: svm: with each flag set, every IDL instruction either refuses or is on the allow-list above; e2e-chain covers pause behaviour.
- Coverage: e2e-chain pause scenarios; unit `limits_hold_large_paused_or_over_cap_payments`, `paused_pool_pays_nothing`.
- Status: PARTIAL (KNOWN I2; L1 mechanism). Ops side: INV-62.

### INV-10 Stored config is always valid
**Statement.** Every `Vault.config` ever stored satisfies `Config::validate` (`C/state.rs:54-78`), whose exact predicates are (`:56-74`): `min_bet > 0`, `min_bet ≤ max_bet`, `max_bet × slots::MAX_MULTIPLE` fits u64, `max_round_gain ≥ min_bet`, `max_player_win ≥ min_bet`, `max_win_multiple > 0`, `min_deposit ≥ min_withdrawal`, `min_deposit > 0`, `min_withdrawal ≤ max_withdrawal`, `max_withdrawal > 0`, `max_withdrawal ≤ player_daily_cap`, `max_withdrawal ≤ daily_cap`, `round_timeout_secs > 0`, `validator ≠ default`, `vrf_queue ≠ default`. Note: `min_withdrawal = 0` is accepted.
- Enforced: `initialize` and `set_config` call `validate` (`C/instructions/admin.rs:38-62`); `PromoConfig::validate` `C/instructions/promo.rs:24`.
- Holes (design, verify before reporting): no upper bounds: `round_timeout_secs = 1` is accepted (fast re-roll window, INV-27); `max_round_gain` may exceed `u64::MAX / FEE_BPS`, which makes `settle` panic on a large win (`C/settlement.rs:27`, INV-16); caps can be set arbitrarily high. `set_config` replaces the whole struct (no partial update, no timelock), so an ops read-modify-write can silently revert a concurrent change (INV-62).
- Second barrier: none (admin trusted).
- Test: prop-rs: for any `Config` accepted by `validate`, every game's `max_gain` and `settle` stay panic-free for every bet in `[min_bet, max_bet]` (links INV-16).
- Coverage: `config_validation_refuses_settings_that_break_play`, `config_needs_a_daily_cap_covering_one_payout`.
- Status: PARTIAL (no upper bounds; admin trusted).

### INV-11 Win cap: net win never exceeds the reserved `max_win`; reservation growth is bounded
**Statement.** In the ER, between rounds `net_win(balance) = balance + withdrawn − credited + forfeited ≤ max_win`; when a round starts, its worst case `net_win(balance + max_gain) ≤ max_win` (`check_win_cap` `C/state.rs:361-368`, `net_win` `:371-373`). The ER `max_win` never exceeds Solana's `ledger.max_win` (`sync_ledger` takes `max()`, `C/state.rs:352-358`). Every unit of `max_win` is reserved in `vault.reserved` (INV-02). **As documented in `Config`** (`C/state.rs:21-24`): `max_player_win` is the "Largest lifetime net win reserved for one player" and "A player's reserved max win may not exceed this multiple [`max_win_multiple`] of their first deposit".
- Enforced: `take_stake` `C/state.rs:437-462`; split re-check `take_split` `:466-479`; a double is covered because blackjack `max_gain = 2 × total` at bet time. `max_player_win` and `max_win_multiple` are checked **only** in `open_account` (`C/instructions/account.rs:66-69`).
- Second barrier: Solana `checked_due` bounds withdrawals by `deposited − forfeited + max_win` (INV-03) even if the ER were wrong.
- GAP (lead, verify with Armand; his zone, do not settle in code): `Ledger::raise_win_cap` (`C/state.rs:124-145`) bounds one raise by `max_round_gain` and `free` but ignores both `max_player_win` and `max_win_multiple`, so the documented intent of `state.rs:21-24` is violated after the first raise. The relay raises automatically on `WinCapReached` (`W/chain.ts:311-325`, raise `:332-358`). New angle: sybils with high-multiplier bets can grow reservations with no lifetime ceiling until `free → 0` ⇒ `VaultTooSmall` for every new account and raise, and `withdraw_house` is blocked (bankroll lock).
- KNOWN (prior audit "Modèle de confiance": "`max_win` se remet à zéro à chaque checkpoint"): lifetime **wins** are unbounded because a checkpoint resets net win (INV-21); the reservation stays covered. Do not report that part as new.
- Test: prop-rs over random game sequences per game (incl. double after split after raise with a stale ledger): `net_win ≤ max_win` after every settle; sim: K sybil accounts × raises vs `free`, cost per locked unit.
- Coverage: `win_cap_counts_the_worst_case_including_a_double`, `a_split_is_refused_once_its_worst_case_passes_the_win_cap`, `a_raised_win_cap_is_taken_and_a_stale_copy_never_lowers_it`, `a_raise_reserves_what_it_adds_to_the_cap_within_the_free_bankroll`, `the_win_cap_applies` (quick).
- Status: GAP (raise ignores the documented caps); per-round cap OK.

### INV-12 Deposits are credited in the ER exactly once
**Statement.** `PlayerAccount.credited ≤ ledger.deposited` (Solana value) and `credited` never decreases; the ER balance grows from deposits only through `sync_ledger`, by `deposited − credited`.
- Enforced: `sync_ledger` `C/state.rs:352-358`.
- Second barrier: Solana re-checks `claim.credited ≤ ledger.deposited` in `checked_due` (`C/withdrawals.rs:15-18`).
- Trust: the ER clone of `Ledger` may be stale or (lead, verify) cloned below finalized; a dropped deposit would credit phantom funds; `checked_due` then refuses every withdrawal with `FraudSuspected` until real deposits catch up (fail closed, player frozen).
- Test: prop-rs: any sequence of ledger snapshots (including older ones) applied to `sync_ledger` credits `max(deposited seen)` exactly.
- Coverage: `deposits_are_credited_once_even_from_a_stale_ledger`, `claim_crediting_deposits_that_never_happened_is_refused`.
- Status: OK.

### INV-13 USDC conservation; outflows only at listed sites
**Statement.** For every Solana tx, over Tilt's mint: Δ`vault_token` + Δ`promo_token` + Δ(player ATAs) + Δ`treasury` + Δ(funder accounts of `fund_vault`/`fund_promo`) = 0, and the program moves tokens only at these `transfer_checked` sites:

| Site | From → to | Signer |
|---|---|---|
| `open_account` `C/instructions/account.rs:73-88` (helper `transfer_in` `:11-30`) | player → vault_token (`credited`), player → treasury (onboarding fee) | player |
| `deposit` `C/instructions/account.rs:151-172` | player → vault_token | player |
| `fund_vault` `C/instructions/admin.rs:91-106` | any funder → vault_token | funder (anyone) |
| `withdraw_house` `C/instructions/admin.rs:128-147` | vault_token → treasury | vault PDA, admin-gated |
| `pay_due` `C/withdrawals.rs:161-176` | vault_token → player ATA | vault PDA (action / admin release) |
| `fund_promo` `C/instructions/promo.rs:132-147` | any funder → promo_token | funder (anyone) |
| `pay_promo` `C/instructions/promo.rs:195-208` | promo_token → any ATA of the mint | promo PDA, relayer-gated |
| `withdraw_promo` `C/instructions/promo.rs:239-254` | promo_token → treasury | promo PDA, admin-gated |

- Second barrier: none (no on-chain or off-chain reconciliation job; §K eq. 4 is the check to add).
- Test: `rg -n "transfer_checked|transfer\(" chain/programs/tilt/src` must list exactly these; svm asserts per-tx deltas sum to 0 and the ledger delta equals the token delta.
- Coverage: none as a property.
- Status: OK-untested. Any new site is a priority review target.

### INV-14 Promo pool: one payment per payout id, within caps
**Statement.** At most one `pay_promo` per `payout_id` (16 bytes); `0 < amount ≤ max_payout`; per 24 h block `paid ≤ daily_cap`; `promo.paid_total == Σ payouts`; nothing while `paused`.
- Enforced: `payout` `init` seeds `["payout", payout_id]` (`C/instructions/promo.rs:161`); `promo_payment` `:61-74` (pause and caps `:70`); `paid_total` checked add `:183-187`.
- By design: `player_token` is only `token::mint = mint` (`:163`), so any destination; the relayer (and the api admin plane behind it) is trusted to pick winners (INV-51). `PromoPayout` is never closed (rent, KNOWN I6; relayer cost INV-65).
- Second barrier: relay `MIN/MAX_PROMO_PAYOUT`, `DAILY_PROMO_LIMIT` (INV-38); api deterministic payout id (INV-51).
- Test: svm: the same id twice fails; prop-rs on `promo_payment` windows (2x at a boundary like INV-08).
- Coverage: `payouts_stay_within_the_per_payout_and_daily_caps`, `the_daily_cap_resets_with_the_next_block`, `paused_pool_pays_nothing`; e2e duplicate/cap/auth/pause.
- Status: TRUST (destination chosen by the relayer); caps OK.

### INV-15 Authority matrix per instruction
**Statement.** Each instruction is callable only by its intended principal, and every account it touches is pinned (PDA seeds, `has_one`, `address`, `token::mint/authority`).

| Principal | Instructions | Pin |
|---|---|---|
| upgrade authority | `initialize` | `program_data.upgrade_authority_address == admin` `C/instructions/admin.rs:13-19` |
| admin (`vault.admin`) | `set_config`, `set_roles`, `withdraw_house`, `release_withdrawals`, `init_promo`, `set_promo`, `withdraw_promo` | `has_one = admin` (e.g. `admin.rs:54,114`, `promo.rs:81,104,223`) |
| relayer (`vault.relayer`) | every ER move, `withdraw`, `checkpoint`, `expire_*`, `open_*`/`delegate_*`, `raise_win_cap`, `pay_promo`; payer of `open_account` and of every game-PDA `init` | `address = vault.relayer` (e.g. `play.rs:31`, `account.rs:39,107,176`, `mines.rs:23`, `withdraw.rs:31`), `has_one = relayer` (`promo.rs:155`) |
| player | `open_account` (with relayer), `deposit` | `player: Signer` + `token::authority = player` (`account.rs:41,46,137,142`) |
| VRF program (scoped identity) | `consume_*randomness` | `#[vrf_callback]` injected signer, INV-25 |
| delegation program (escrow PDA) | `pay_withdrawals`, `apply_checkpoint` | INV-31 |
| **anyone** | `fund_vault`, `fund_promo` | `funder: Signer`, `token::authority = funder` (`admin.rs:79,84`, `promo.rs:125`) |

- GAP (lead, verify): `fund_vault`/`fund_promo` let any signer move **its own** USDC into the vault or the promo pool, and `deposit` has no on-chain size cap. Combined with a Privy policy that checks only the program id (INV-41), a leaked Privy credential can sign these for every delegated player wallet. Impact per capability is split in INV-41; do not rate it as "sweep to attacker" without the extra key it needs.
- Second barrier: none on-chain for `fund_*` callers.
- Test: svm negative matrix generated from the IDL: for every instruction × account slot, substitute (other player's PDA, attacker-created same type, wrong owner, wrong mint, non-canonical bump, duplicate of another slot) and drop each signer; expect a specific error code.
- Coverage: e2e-chain (init by non-authority, raise auth, promo auth, direct `pay_withdrawals` call). No svm matrix.
- Status: GAP (`fund_*` × Privy policy); else OK. KNOWN L2: one-step `set_roles`.

### INV-16 No wrap, and no reachable panic on accepted input
**Statement.** Arithmetic never wraps (release profile `overflow-checks = true`, `chain/Cargo.toml:6`); checks that combine u64 values use u128 (`withdrawals.rs:19-22,189-193`, `account.rs:68`). No input accepted at round start can make a later instruction (especially a VRF callback) panic.
- Panicking sites to keep unreachable: `settle` `gain * FEE_BPS` (`C/settlement.rs:27`; overflows when a gain exceeds `u64::MAX / 100`, which `validate` allows since `max_round_gain` has no upper bound, INV-10), `games::to_u64` `C/games/mod.rs:26`, `mul_div` `C/settlement.rs:36-38`, `MinesBoard::gross` `C/games/mines.rs:126`, `dice` `C/games/dice.rs:53`, `QuickRound::Empty` `C/games/quick.rs:89`, keno `C/games/keno.rs:64`, slots `C/games/slots.rs:57`, blackjack `C/games/blackjack.rs:356`, `Rng::below(0)` (`C/rng.rs:28-37`, only `debug_assert!`).
- Why it matters: a callback that panics leaves the round `AwaitingDraw`. The relay sweeper then calls `expire_*` on its own with a fresh seed (`W/sweeper.ts:51-53`, INV-27). If the panic depends on state only, it panics again forever (stake frozen, `checkpoint` blocked because it needs Idle). If it depends on the randomness, the losing (or winning) draws get re-rolled automatically: a bias (INV-28).
- Second barrier: none (the sweeper turns a panic into a re-roll rather than stopping it).
- Test: prop-rs: for every game, every valid start (bounded by any `Config` passing `validate`) and every randomness sequence, the game fns and `settle` return without panic and `gross ≤ stake + max_gain`.
- Coverage: `a_huge_stake_is_out_of_range_not_a_panic`, `mul_div_handles_large_values`, `every_hand_and_split_fits_the_table`, roulette "saturates instead of panicking".
- Status: PARTIAL (unchecked `+=`/`*` in hot paths rely on overflow-checks; proven bounds are per-test, not properties).

---

## B. Rollup: rounds and the player account (MagicBlock ER)

### INV-17 One round per player; stake taken before the draw request
**Statement.** A player has at most one round in progress; the stake is debited from `balance` in the same instruction that requests the draw (or opens a `PlayerTurn` board), before any randomness exists; there is no path that returns a stake without settling the round.
- Enforced: `check_can_start` `C/state.rs:426-433`; `take_stake` debits then sets the round `:437-462`; `draw_request` sets `AwaitingDraw` `C/instructions/play.rs:86-111`. Mines/Tower start in `PlayerTurn` with no draw (`mines_bet`, `tower_bet`) but the stake is taken.
- No refund path exists (no `cancel`/`refund` instruction): verify none is added.
- Second barrier: relay one-intent-in-flight (INV-35), mod one move in flight (INV-60).
- Test: prop-rs state machine over all instructions: `Idle → (PlayerTurn | AwaitingDraw)* → Idle`; never a second stake while non-Idle; never a balance increase while non-Idle except by callback/cash-out settlement and `sync_ledger`.
- Coverage: `a_round_in_progress_blocks_a_new_bet` (quick), `a_pending_reveal_blocks_every_other_move` (mines), `limits_are_enforced_when_a_round_starts`.
- Status: OK.

### INV-18 Round conservation and fee rules
**Statement.** For each settled round: `balance_after = balance_before − stake + payout`; if `gross > stake` then `fee = max(1% of gain, MIN_FEE = 1)`, `payout = gross − fee ≥ stake`; if `gross ≤ stake`, `payout = gross`, `fee = 0`; `gross ≤ stake + max_gain_at_start`.
- Enforced: `settle` `C/settlement.rs:18-32`; `finish_round` `C/state.rs:481-488`; per-game caps (mines/hilo/tower cap at `bet + board.max_gain`, roulette max over pockets `C/games/roulette.rs`, blackjack `≤ 2 × stake`).
- Second barrier: win cap (INV-11) and Solana `checked_due` (INV-03) bound what a wrong payout can withdraw.
- Test: prop-rs per game: `gross ≤ stake + max_gain(params)` for every randomness; `settle` identities for all `(stake, gross)`.
- Coverage: `every_win_pays_a_fee_and_at_least_the_stake`, `fee_is_one_percent_of_the_gain_only`, `no_fee_on_push_or_loss`, `fee_rounds_down_in_the_players_favour`, `a_round_takes_the_stake_and_settlement_returns_the_payout`, `max_gain_is_every_safe_tile_within_the_round_limit`, `the_max_gain_is_the_best_pocket_net_of_every_chip`.
- Status: OK.

### INV-19 Per-round limits are refused, never capped
**Statement.** Each bet is in `[min_bet, max_bet]` (per hand / per chip); a round's `max_gain ≤ max_round_gain` or the bet is refused (never silently capped); `balance ≥ stake`.
- Enforced: `start_round` `C/state.rs:378-398`, `start_round_of` `:400-424`, `take_stake` `:444-451` (balance `:449`), `take_split` `:466-479`; quick games `QuickRound::max_gain` → `InvalidChoice`; roulette `chips_are_valid` (1..=20 distinct).
- KNOWN (I2): `blackjack_double` re-checks only the balance (`C/instructions/play.rs:215-228`): a doubled hand reaches 2x `max_bet`, and no pause check.
- Second barrier: api/mod bet sizes are UX only (INV-57); none other.
- Test: prop-rs: for random params/chips, accepted ⇒ every bound holds; refused ⇒ state unchanged.
- Coverage: `bet_limits_apply_per_hand_and_the_round_gain_to_the_total`, `a_choice_that_could_gain_too_much_is_refused_not_capped`, `choices_outside_the_rules_are_refused_before_the_stake`, `layouts_outside_the_rules_are_refused_before_the_stake`, `bets_of_their_own_sizes_are_each_limited_and_staked_together`.
- Status: KNOWN (double); else OK.

### INV-20 ER balance conservation over a player's life
**Statement.** At every point: `balance + open_stake + withdrawn == credited + Σ_settled(payout − stake)`. `forfeited` and `fees` are bookkeeping only and never touch `balance`.
- Enforced by construction: only `sync_ledger` (+credit), `take_stake`/`take_split`/double (−stake), `finish_round` (+payout), `withdraw` (−amount, +withdrawn) touch `balance` (`C/state.rs:352-488`, `C/instructions/withdraw.rs:62-63`).
- Second barrier: Solana `checked_due` (INV-03) caps the damage of an ER drift at the player's allowance.
- Test: prop-rs random op sequences {sync, bet any game, draw, cash-out, double, split, withdraw, checkpoint} with a shadow ledger; assert equality after each op.
- Coverage: `withdrawals_and_forfeits_do_not_change_net_win` (partial).
- Status: OK-untested.

### INV-21 Checkpoint releases only realized losses
**Statement.** `checkpoint` runs only when the round is `Idle`; it adds exactly `unforfeited_loss()` to `forfeited`; afterwards `unforfeited_loss() == 0`; `forfeited` never decreases and never counts a stake in flight or a deposit the ER has not yet credited. Solana releases `claim.forfeited − ledger.forfeited` from `reserved`, bounded by INV-03.
- Enforced: ER `checkpoint` `C/instructions/withdraw.rs:201-239` (Idle `:204-207`, `unapplied` re-push `:211-212`, `exit` `:214`); `unforfeited_loss` `C/state.rs:491-499`; Solana `apply_checkpoint` `C/instructions/withdraw.rs:265-285` + `checked_forfeit` `C/withdrawals.rs:187-196`.
- Second barrier: `checked_forfeit` on Solana (INV-03).
- KNOWN ("Modèle de confiance"): "the player's win headroom starts again from here" (doc comment `withdraw.rs:198-200`): a checkpoint makes `net_win` 0, so past losses no longer offset future wins against `max_win`; lifetime wins are unbounded while the reservation stays covered.
- Test: prop-rs: sequences mixing checkpoint/withdraw/deposit-not-yet-synced; assert `forfeited ≤ credited` and released ≤ realized loss; svm: apply the same checkpoint twice, and a checkpoint racing a withdraw action in both orders.
- Coverage: `forfeits_are_bounded_and_only_count_once`; e2e-chain checkpoint scenario. No interleaving test.
- Status: OK-untested.

### INV-22 ER withdraw bounds and flush-before-commit
**Statement.** `withdraw(amount)`: `0 < amount ≤ balance`; `amount ≥ min_withdrawal` unless it empties the balance; `withdrawn` increases by exactly `amount`; the account is flushed (`exit`) before the commit snapshot so the committed claim includes this debit. Withdrawing mid-round never touches the stake in flight.
- Enforced: `C/instructions/withdraw.rs:50-95` (checks `:54-61`, debit `:62-63`, `exit` `:66`, action metas `:68-80`).
- Second barrier: Solana `checked_due` (INV-03) for amounts; none for the relayer's commit cost (INV-65).
- Test: svm/e2e: the committed `PlayerAccount.withdrawn` equals the ER value right after `withdraw`; dust loop (deposit `min_deposit` → withdraw all) costs the attacker at least the relayer's commit + action cost (`min_deposit ≥ min_withdrawal`, doc `C/state.rs:27-30`; note `min_withdrawal = 0` is accepted by `validate`).
- Coverage: e2e-chain; no unit test of the handler.
- Status: OK-untested. Keep a regression test on the `exit`: without it the commit snapshots the pre-debit state.

### INV-23 Delegated account layouts never change
**Statement.** The byte layout of `PlayerAccount` and of every delegated board/table is fixed: Solana deserializes committed bytes (`read_claim` `C/withdrawals.rs:84-87`), and delegated accounts cannot be resized, so a layout change on live accounts would misread claims.
- Enforced: golden tests only. Any field change needs a migration plan (new seed), not a code change. Precedent: the old `b"table"` blackjack PDAs held the 6-hand layout and are abandoned but still delegated; the 10-hand table lives under `b"bjtable"` (`C/constants.rs:5-7`).
- Second barrier: none.
- Coverage: `player_account_layout_is_unchanged` (`C/state.rs:787`), `board_layout_is_fixed` (`C/games/mines.rs:343`, `C/games/hilo.rs:427`, `C/games/tower.rs:305`), `table_layout_is_fixed` (`C/games/quick.rs:249`, `C/games/roulette.rs:434`). **Missing: `BlackjackTable` (`C/games/blackjack.rs`) has no layout test.**
- Test: add the `BlackjackTable` golden test; check nothing still reads or writes the abandoned `b"table"` accounts.
- Status: PARTIAL (no `BlackjackTable` test).

### INV-24 Delegation is pinned to the configured validator, relayer-only
**Statement.** Every delegated PDA is delegated with `validator: Some(config.validator)` and only by the relayer; the program never requests undelegation (`commit_and_undelegate` absent); the macro-injected `process_undelegation` (`#[ephemeral]` on the module, `C/lib.rs:36`) only accepts the canonical buffer signed by the delegation program.
- Enforced: `validator: Some(validator)` at `C/instructions/account.rs:127`, `table.rs:56`, `mines.rs:66`, `quick.rs:70`, `hilo.rs:66`, `tower.rs:66`, `roulette.rs:67`; `delegate_account` requires `ledger.deposited > 0` (`account.rs:120`); game boards need an existing `Ledger` (e.g. `mines.rs:27-29`).
- Trust: the validator sequences the ER, sets its clock, chooses clone freshness and commits state. Its power over money is bounded per player by INV-03/INV-32 (KNOWN, "Confiance dans le validateur du rollup"); over outcomes see INV-27. Changing `config.validator` affects only new delegations (split brain: lead, verify relay handling).
- Second barrier: INV-32 on Solana.
- Test: `rg -n "validator:" chain/programs/tilt/src` must show only `Some(validator)` from config; svm: delegate with a non-relayer payer fails.
- Coverage: none direct.
- Status: TRUST (validator); OK-untested.

---

## C. VRF and randomness (MagicBlock VRF, scoped identity)

### INV-25 Only the VRF program can deliver randomness
**Statement.** Every `consume_*randomness` requires the scoped VRF identity signer (`#[vrf_callback]` injects `vrf_program_identity: Signer` with `address = scoped_vrf_identity(&crate::ID)`), and its accounts are constrained by seeds to the player's own PDAs.
- Enforced: `ConsumeRandomness` `C/instructions/play.rs:47-57` and the per-game callback structs (`mines.rs`, `quick.rs`, `hilo.rs`, `tower.rs`, `roulette.rs`); requests use `create_request_scoped_randomness_ix` with `oracle_queue` pinned to `vault.config.vrf_queue` (`play.rs:43-44,100-110`).
- Second barrier: INV-26 binding (a forged answer must also match `request_id` and state).
- Test: svm: call each `consume_*` from a plain wallet (expect signer/address error) and with another player's callback account (expect seeds error).
- Coverage: contract `program.test.ts` checks callback PDAs (`only lets the VRF callback write to a player account PDA`, per-game variants). No negative on-chain test.
- Status: OK-untested (negative). Lead (verify, off-repo): the VRF program only lets the program's own `["identity"]` PDA request callbacks into Tilt, and `callback_args`/metas are immutable.

### INV-26 An answer settles only the request it was made for
**Statement.** A callback is applied iff `status == AwaitingDraw(d)` and `request_id == round.request_id`; `request_id` strictly increases over the account's life (never reset at round start); each `(game, draw)` pair is accepted by exactly one callback kind; a stale, foreign, duplicate or cross-game answer changes nothing.
- Enforced: `draw_request` `request_id += 1` and `callback_args = request_id` (`C/instructions/play.rs:97,108`); `pending_draw` `:307-313`; `take_stake` keeps `request_id` (`C/state.rs:456`); game checks `check_mines_draw` (`C/instructions/mines.rs:144`), quick `!quick.drawn`, hilo `awaits_card`, tower pending, roulette `!landed()`.
- Second barrier: INV-25 (only the VRF identity can call).
- Test: prop-rs: random interleavings of {request, expire, callback(any id)} ⇒ each request id settles ≤ 1 time and only the latest pending one.
- Coverage: `only_the_pending_request_is_answered`, `stale_foreign_or_replayed_randomness_is_refused` (quick, mines, hilo, tower, roulette), `draws_that_do_not_belong_to_the_game_are_refused`, `each_game_plays_its_draws_on_exactly_one_callback`, `only_a_chips_spin_plays_on_the_roulette_table`.
- Status: OK. Note: a stale answer returns `Err(StaleRandomness)`, so the oracle's fulfil tx reverts (retry loop; the randomness is visible in the failed tx). Consider `Ok(())` + event.

### INV-27 No re-roll and no selective abort
**Statement.** Once a stake is committed and a draw requested, nobody (house, relayer, relay jobs, validator, oracle, player) can replace an unfavourable outcome with a fresh one, cancel the round, or get the stake back. The outcome distribution is independent of `client_seed`, of who calls `expire_*`, of whether the first callback failed, and of how many retries happened, given an honest oracle.
- Enforced: the only re-request paths are `expire_round` / `expire_{mines,quick,hilo,tower,roulette}_round`, relayer-only, allowed only in `AwaitingDraw` after `now − last_action ≥ round_timeout_secs` (`expired_draw` `C/instructions/play.rs:289-295`, `draw_to_retry` `:299-304`); they re-request the **same** draw under `request_id + 1`, so the older answer becomes stale (INV-26). `PlayerTurn` is never expired. No refund/cancel instruction exists. `client_seed` is relay `randomBytes(32)` (`seed()` `W/chain.ts:170`), never player-supplied.
- **Automatic re-request path (no insider needed):** the honest relay sweeper calls `chain.expireRound` for **every** round in `AwaitingDraw` past `round_timeout_secs` (`W/sweeper.ts:51-53`), which sends `expire_*` with a fresh `seed()` (`W/chain.ts:364-388`). So any callback that reverts, panics, runs out of CU or is merely delayed gets a new draw automatically.
- Lead X1 (verify): if a callback can fail as a function of the randomness (INV-28, INV-16) or of state the attacker times (e.g. a concurrent change to an account the callback writes), the failure + sweeper re-roll is a systematic bias with no privileged actor. The failed fulfil tx also publishes the randomness (tx data/logs), so an observer learns the discarded outcome.
- TRUST + KNOWN (prior audit "Modèle de confiance", "`expire_round` permet de relancer un tirage en attente"): whoever sees the oracle answer before it executes (ER sequencer, a relayer with privileged ER access) can wait for the timeout and `expire_*` to discard it; `Config::validate` accepts `round_timeout_secs = 1` (`C/state.rs:72`). The ER clock is validator-controlled (lead: can it be skewed to expire a round early?). Compromised relayer + selective `expire` on its own accounts is X7 (INV-66).
- Second barrier: none on-chain. Detection: none (no expiry or failed-callback rate in `W/monitor.ts`, INV-63).
- Test: (1) svm/local stack: a callback that errors ⇒ the sweeper sends `expire_*` with a new seed, and the round settles on the second draw: assert the outcome distribution conditioned on "first callback failed" equals the unconditioned one; (2) measured expiry rate per player and per game on the local stack, and in the monitor; (3) e2e: expire before timeout fails (`RoundNotExpired`); (4) `validate` refuses timeouts below a floor once one is added.
- Coverage: `only_a_pending_draw_is_retried_never_a_hand_waiting_for_the_player`; relay `never closes a hand or board waiting for the player, only retries a draw that never arrived` (`apps/wallet/test/intents.test.ts:221`). Nothing on failed callbacks.
- Status: TRUST (oracle/sequencer); KNOWN (min timeout); lead X1 (automatic re-roll on callback failure).

### INV-28 Callbacks never fail as a function of the randomness
**Statement.** For every valid round state and every 32-byte randomness, the callback succeeds within its compute budget. An outcome-dependent revert, panic or out-of-CU is a deterministic bias, because the sweeper re-rolls the failed draw automatically (INV-27, `W/sweeper.ts:51-53`), and it publishes the discarded randomness.
- Enforced: game fns are total over accepted states (INV-16); `apply_draw` matches `(game, draw)` (`C/state.rs:270-316`).
- Second barrier: none (see INV-27).
- Test: prop-rs: every game's draw/settle fn over arbitrary randomness and every reachable state (blackjack 10 hands with splits and the dealer loop, hilo at `MAX_CARDS = 64`, keno 10 picks, roulette 20 chips): no panic, no `Err`; measure worst-case CU on the local stack vs the callback budget.
- Coverage: `every_hand_and_split_fits_the_table`, `dealer_draws_nothing_when_every_hand_is_bust`, `every_game_settles_its_spin`, `a_split_draw_plays_on_the_table`. No CU test.
- Status: OK-untested (as a property). Leads (verify): hilo guess at 64 cards indexing `cards[64]`; `Rng::below(0)` reachable from any paytable; `settle` overflow (INV-16).

### INV-29 No future outcome is readable before it is locked
**Statement.** No account, log or event exposes a card, mine, tile or pocket before the stake for it is locked. Mines/Tower/Hilo draw lazily per reveal (no stored layout). While a draw is pending, every other move of that game (cash-out, new reveal, new bet) is refused, and `withdraw` cannot touch the stake.
- Enforced: `require_mines_turn` / `check_cash_out` (`C/instructions/mines.rs:123-142`); `check_cash_out` in `tower.rs:136` and `hilo.rs:135`; `check_can_start` blocks new bets (INV-17).
- Second barrier: none (VRF output is public once delivered; only the lock order protects).
- Test: for every game, from `AwaitingDraw` try every other instruction (expect `WrongState`/`RoundInProgress`); scan account structs for fields holding undrawn outcomes.
- Coverage: `a_pending_reveal_blocks_every_other_move` (mines), `a_reveal_is_a_mine_as_often_as_on_a_random_layout`. Missing: the same negative test for hilo, tower, blackjack, roulette, quick.
- Status: OK-untested (non-mines); mines OK.

### INV-30 Unbiased sampling; RTP as documented
**Statement.** `Rng::below(n)` is uniform (rejection sampling) and `n > 0` always; each game's **gross** RTP, before Tilt's 1% fee on gains (`C/settlement.rs:3-7`; e.g. `C/games/slots.rs:2` "before Tilt's fee"; the tests compute gross EV), equals the documented value: dice/flip/wheel 98%, mines 99%, hilo/tower 98% at every cash-out point, keno 94.90-95.00%, slots 96.16%, roulette 97.30% (36/37), baccarat Player 98.76 / Banker 98.94 / Tie ~85.9, limbo ≤ 98%. Net RTP below these figures is expected, not a finding. The api TS ports replay exactly the Rust rules.
- Enforced: `C/rng.rs:9-37` (`from_vrf` XOR-folds 32 bytes into a 64-bit splitmix seed; acceptable for an unpredictable VRF output, not a vuln per se); games in `C/games/*`.
- Second barrier: none on-chain; RTP drift detection is missing (INV-63).
- Test: exact-RTP enumeration tests (present); differential Rust vectors vs TS (present).
- Coverage: `draws_cover_the_whole_range_evenly`, `same_randomness_replays_the_same_draws`, `rtp_is_98_percent_for_every_target` (dice), `rtp_is_99_percent_at_every_cash_out_point` (mines), `every_guess_keeps_98_percent` (hilo), `every_paytable_returns_94_90_to_95_00_percent_exactly` (keno), `every_bet_returns_36_out_of_37` (roulette), `every_wheel_returns_exactly_98_percent`, `rtp_is_at_most_98_percent_and_never_far_below` (limbo); `apps/api/test/games.test.ts` vs `apps/api/test/fixtures/rust-vectors.json`.
- Status: OK. Economic leads (positive-EV strategies, leaderboard/drop farming) live in INV-51.

---

## D. Rollup → Solana settlement (commit + Magic Action)

### INV-31 Magic Action handlers run only as the scheduled post-commit action
**Statement.** `pay_withdrawals` and `apply_checkpoint` succeed only when signed by the MagicBlock escrow PDA `ephemeral_balance_pda_from_payer(escrow_auth, 255)` with `escrow_auth == vault.relayer`, and `this_program == crate::ID`.
- Enforced: `PayWithdrawals` `C/instructions/withdraw.rs:97-127` (`signer` + `address` `:121-124`, `this_program` `:114-116`), handler check `:129-135`; `ApplyCheckpoint` `:241-262`, handler `:265-271`.
- Trust (lead, verify off-repo): only the delegation program can sign for the escrow PDA, and only for an action scheduled in an ER tx the escrow authority (relayer) signed. MagicBlock `#[action]` does not restrict callers by itself; Tilt's explicit escrow `signer` + `address` constraints gate it. `escrow_auth` is a wallet, not a program PDA.
- Second barrier: INV-05 and INV-32 bound a broken gate to what is owed, paid to the player; the attacker could still spend the relayer escrow and time payments around window rolls.
- Test: e2e/svm: a direct call without the escrow signature fails; with a different `escrow_auth` it fails.
- Coverage: e2e-chain direct `pay_withdrawals` → `ConstraintSigner` (`chain/scripts/e2e.ts:1140-1155`).
- Status: TRUST (escrow signing); OK (e2e).

### INV-32 Committed rollup state is bounded by Solana truth
**Statement.** Whatever the rollup commits (honest, stale, forked or malicious validator), Solana pays a player at most `deposited − forfeited + max_win − withdrawn_paid`, never credits more than `deposited`, and releases forfeits only within INV-03. A claim for another player is refused.
- Enforced: `read_claim` (discriminator check, address fixed by seeds `["account", ledger.player]`, **no owner check**) `C/withdrawals.rs:84-87`; `checked_due` / `checked_forfeit` (INV-03).
- Trust (KNOWN, "Confiance dans le validateur du rollup"): bound is per player only. A compromised validator can make each player's account claim its full allowance (its own deposits + win cap), paid to that player's own ATA (INV-06). Total exposure = Σ `max_win` across colluding players, which is what `reserved` covers.
- Second barrier: INV-06 (destination pinned to the player).
- Test: svm with `set_account` forging the committed `PlayerAccount` bytes (max `withdrawn`, other `player`, `credited > deposited`): expect `FraudSuspected`; lead: an account at that PDA owned by a third program.
- Coverage: unit `claim_*` tests in `C/withdrawals.rs`; no forged-account svm test.
- Status: OK.

### INV-33 Failures leave money owed, never lost and never double-paid
**Statement.** If a commit, action, VRF answer, relay or ER stops or fails, the system fails closed (nobody is paid wrongly) and a recovery path eventually pays every player what is owed: a held/failed withdrawal stays in `withdrawn − withdrawn_paid` and in `reserved`, payable by the next commit or `release_withdrawals`; a failed checkpoint is re-pushable (`unapplied`, `C/instructions/withdraw.rs:211-212`).
- Failure modes to model: wrong/closed/frozen `player_token` in the ER metas (`UncheckedAccount`, `withdraw.rs:37-44`); `vault_token` short (`VaultTooSmall` reverts the action and, per MagicBlock docs, the whole commit: lead, verify what the committor does next); relayer rotated with actions in flight (`escrow_auth ≠ relayer` ⇒ `Unauthorized`); escrow empty (`LOW_ESCROW` alert); **USDC freeze**: Circle can freeze `vault_token` or the treasury (the freeze authority of the USDC mint; Circle froze casino hot wallets in March 2026, research note G-A1, unverified): every `pay_due` and `withdraw_house` then reverts and no code path recovers (ops: INV-62/63, runbook).
- KNOWN ("Aucune sortie de secours"): if the ER or relay is down, players cannot withdraw (`chain/README.md`). All or nothing: after one held payment every later automatic payment for that player is held until it fits the caps or is released.
- Second barrier: admin `release_withdrawals` (single key, INV-61).
- Test: e2e/svm: each failure mode above, then recovery; assert INV-01..05 hold throughout and the final paid total equals `withdrawn`.
- Coverage: e2e-chain held withdrawal + admin release. Nothing for rotation in flight, escrow exhaustion, frozen ATA or frozen vault.
- Status: TRUST (MagicBlock, Circle); KNOWN (no escape hatch).

---

## E. Relay (`apps/wallet`, Armand's zone)

Pipeline: `app.ts` zod → `requireConsent` (money only) → `Intents.submit` → `claim()` (advisory lock, insert pending) → `executor.execute` → `chain.ts` simulate → `record()` → send → `settle()`; `reconcile()` and `expireRound` from the sweeper.

### INV-34 At most one execution per intent id; replay bound to (user, action)
**Statement.** For any interleaving of N concurrent `submit` with the same `intent_id`, `executor.execute` runs ≤ 1 time. A stored id replayed with another `userId` or any different action field ⇒ `INTENT_CONFLICT`; the same ⇒ the stored outcome, no re-execution, no limit re-check. Ids are lowercased UUIDs; action equality uses key-order-independent `canonical()`.
- Enforced: `claim` `W/intents.ts:207-238` (per-user `pg_advisory_xact_lock` `:212`, PK insert, unique-violation fallback `:229-235`); `replay` `:240-245`; `canonical` `:60-67`; DB PK on `intents.intent_id` (`W/db.ts:28-40`).
- Second barrier: on-chain idempotency for some money moves (INV-05, PDA `init` on open, `PromoPayout` per id). **Deposits have none on-chain: each landed send moves real tokens** (INV-67).
- Test: race: 50× same id, same user; same id two users; key-permuted action; case-variant id.
- Coverage: `runs an intent once, however often it is submitted`, `refuses to reuse an intent id for a different action or player` (`apps/wallet/test/intents.test.ts:75,85`).
- Status: OK. Cross-namespace issue with promo ids: INV-48.

### INV-35 One non-promo intent in flight per player
**Statement.** At any instant a player has at most one `pending` intent other than `promo_payout`. Promo payouts never make a player busy and are never blocked by one.
- Enforced: partial unique index `intents_one_pending_play_per_user ON intents(user_id) WHERE status='pending' AND action->>'type' <> 'promo_payout'` (`W/db.ts:48-49`) ⇒ `PLAYER_BUSY` (`W/intents.ts:230`).
- Second barrier: on-chain `check_can_start` (one round per player, INV-17) for moves; nothing on-chain for overlapping deposits.
- Liveness lead (verify): a pending row with a signature stays pending until `height > lastValidBlockHeight + 150` on the rollup (`W/chain.ts:452-461`); if rollup block heights do not behave like Solana's, the player is blocked from every move, deposit and withdrawal. Prior F5 was "réfutée en local, à revérifier sur le rollup devnet" and was about a false `failed` followed by a replay; this is a different (liveness) angle on the same mechanism.
- Test: race: concurrent deposit + withdraw + move for one user ⇒ exactly one runs.
- Coverage: `keeps one intent in flight per player, without tying up the pool`, `pays a prize while the player is mid-round, and lets them play meanwhile`.
- Status: OK.

### INV-36 Record-before-send; landed never `failed`; status monotonic
**Statement.** No transaction for an intent reaches `sendRawTransaction` unless its signature was recorded while the row was still `pending`; a row settled `failed` by reconcile is never sent afterwards. Status moves `pending → {submitted, failed}` and `failed → submitted` only (a landed tx wins); `submitted` is terminal.
- Enforced: `record` guarded `WHERE status='pending'`, throws on 0 rows (`W/intents.ts:160-168`); simulate before send (`W/chain.ts:633`), send (`:641`); `reconcile` `W/intents.ts:177-204` (unsent > 180 s ⇒ `failed`; sent > 120 s ⇒ chain status; update guarded on the signature read); `settle` `:285-299`.
- Trust: RPC answers (`transactionStatus`). A lying or lagging RPC can report `expired` for a landed tx ⇒ `failed` ⇒ the deposit quota is released (INV-38 bypass) and history is inconsistent; `settle` repairs only if the executor itself saw it land.
- Not covered by the record gate (by design, relayer money only): `raise_win_cap`, game-account opens, `expire_*`, `checkpoint` (`withoutRecord`); their cost is INV-65.
- Second barrier: on-chain idempotency where it exists (INV-67).
- Test: race: reconcile vs a slow execution (> 180 s) ⇒ never sent after `failed`; fake RPC returning expired then landed.
- Coverage: `never sends an intent that was settled while it executed`, `settles interrupted intents from the chain`, `lets an execution that saw its transaction land correct a reconciliation failure`, `keeps reconciling past an intent whose status cannot be read`.
- Status: TRUST (RPC); else OK.

### INV-37 Moving a player's USDC needs that player's fresh consent
**Statement.** `open_account`, `deposit` and `withdraw` execute only if this very request carries a Privy identity token that verifies, belongs to exactly `userId`, and is ≤ 300 s old (also on replay). The token is never stored or logged.
- Enforced: `requireConsent` `W/consent.ts:33-49` (called `W/app.ts:97`); token stripped before storing (`W/app.ts:91-101`).
- Second barrier: the api checks the same first (`A/http.ts:136-155`, also refuses `iat` > 30 s in the future); withdrawals only reach the player's own ATA (INV-06).
- KNOWN ("Relais seul signataire dans le rollup … Une clé du relais fuitée peut miser avec les soldes, dans la limite des plafonds"): game moves and promo payouts need no consent (`NEEDS_CONSENT` `W/consent.ts:33`), so the relay API key alone can wager any player's balance. Not new; blast radius in INV-66.
- Holes (leads): the token is not single-use and not bound to intent or amount (any number of money moves within 300 s); `iat` is read from the payload after SDK verification (`W/consent.ts:25`); Privy identity-token freshness semantics (does `iat` refresh silently? see INV-56). Privy **dashboard configuration** is an account-takeover surface outside the repo (allowed origins, a dev app shared with prod, wallet export/import, login-method merging; research G-A2, unverified): anyone who gets a valid identity token for a victim passes this gate. Verify with the founders, read-only.
- Test: vitest matrix: no token / other user's token / 301 s old / future iat / malformed ⇒ `CONSENT_REQUIRED`, nothing stored; log capture never contains the token.
- Coverage: `moves a player's money only with their fresh identity token, and never stores it` (`apps/wallet/test/intents.test.ts:386`); api `need a fresh identity token of the same user: the consent proof` (`apps/api/test/routes.test.ts:504`). No unit test of `PrivyConsentVerifier`.
- Status: PARTIAL (KNOWN: relay key wagers).

### INV-38 Relay caps hold under concurrency
**Statement.** Counting `pending` + `submitted` intents (not `failed`): each deposit ≤ `MAX_DEPOSIT`; Σ deposits per user per rolling 24 h ≤ `DAILY_DEPOSIT_LIMIT`; Σ over all users ≤ `DAILY_DEPOSIT_LIMIT_GLOBAL`; each promo ∈ [`MIN_PROMO_PAYOUT`, `MAX_PROMO_PAYOUT`]; Σ promo per 24 h ≤ `DAILY_PROMO_LIMIT`. Refusals (`CONSENT_REQUIRED`, `PLAYER_BUSY`, `LIMIT_EXCEEDED`) leave no row.
- Enforced: `checkDepositLimits` `W/intents.ts:247-267` (per-user lock from `claim`, then global lock `hashtextextended('deposits', 0)` `:259`); `checkPromoLimits` `:269-281` (lock `'promo_payouts'` `:273`); limits from `W/config.ts`.
- Second barrier: on-chain promo pool caps (INV-14); on-chain `min_deposit`; api per-user daily deposit limit (INV-49). None on-chain for deposit totals.
- Holes: a false `failed` (INV-36, RPC) frees quota; rolling relay window vs fixed on-chain blocks (2x promo at a boundary); caps live only in this DB (DB write ⇒ reset).
- Test: race: 50 concurrent deposits/promos across users at the cap boundary ⇒ Σ accepted ≤ cap exactly.
- Coverage: `caps deposits per transaction and per 24 h, not counting failed ones`, `caps deposits of all players together per 24 h, even when concurrent`, `caps promo payouts per payout and for all players per 24 h, even when concurrent`, `pays promo prizes once, keeps them apart from intents and refuses dust`.
- Status: OK.

### INV-39 No account in a relay transaction comes from request input; the relayer always pays
**Statement.** Every account key in every relay-built tx is a function of (`wallet.address` from Privy/DB cache, on-chain `vault` fields, config `VRF_QUEUE`, `PROGRAM_ID`). Request input reaches transactions only as instruction arguments (amounts, enums, tiles, picks, payoutId bytes). The fee payer is always the relayer; the player key signs only `open_account`/`deposit` txs. Non-staking moves never open a game account. A payout id maps to 16 bytes canonically (case-insensitive), so distinct UUIDs give distinct PDAs and case variants give the same one.
- Enforced: PDA helpers in `packages/contract/src/program.ts`; ATA of `(vault.mint, player)`; `client_seed` = relay `randomBytes(32)` (`W/chain.ts:170`); fee payer `tx.feePayer = this.relayer.publicKey` (`W/chain.ts:650,669`); `ensureGameAccount` only for `STAKING_MOVES`, else `requireGameAccount` (`W/chain.ts:314-315`, `:394`, `:415`); promo id bytes `Buffer.from(payoutId.replaceAll("-", ""), "hex")` (`W/chain.ts:426`; ids are lowercased upstream).
- Second barrier: on-chain pins (INV-06, INV-15).
- New lead (extends prior F9 under a DB-write threat; F9 itself says "Pas de vol possible", only a never-refreshed cache): the `players` table maps userId → wallet forever (`W/players.ts:31,46`, `ON CONFLICT DO NOTHING`); with DB write access, an attacker remaps a victim's wallet ⇒ the victim's promo payouts and displayed funding address go to the attacker (X5). Rate it under the DB-write capability (INV-66).
- Test: prop-ts (fast-check, to add to the relay): for arbitrary valid `Action`s, compiled tx account keys ⊆ the allowed set, fee payer == relayer, the player key signs only open/deposit; non-staking moves never send an open tx.
- Coverage: `apps/wallet/test/chain.test.ts` per-game account wiring (`passes the table to every blackjack move and to no other game`, `passes each new game's own account, not the table, with the action's arguments`). No fuzz.
- Status: OK-untested (fuzz).

### INV-40 Relay identity and exposure
**Statement.** The relay runs only with `RELAYER_SECRET_KEY == vault.relayer`; its HTTP API is reachable only by `apps/api` over a private network, and every route except `/health` needs an API key (≥ 32 chars, constant-time compare over SHA-256).
- Enforced: boot check `W/main.ts:32-34`; `HOST` default `127.0.0.1` (`W/config.ts:39`); keys `W/config.ts:43`; compare `W/app.ts:37`; body limit 8 KiB `W/app.ts:69`; `/health` before auth `:71-74`.
- Holes: no in-process rate limit on any relay route (INV-50); network isolation is unverifiable from the repo (no deploy manifests); `RELAYER_SECRET_KEY` and the Privy secrets sit in the same process environment (INV-41, INV-66).
- Second barrier: none behind the API key for no-consent actions (INV-37 KNOWN).
- Test: vitest: every route without/with a wrong key ⇒ 401; config rejects short keys.
- Coverage: `requires one of the API keys`, `validates requests before running them`.
- Status: PARTIAL.

### INV-41 The relay's Privy quorum can only sign what Tilt intends
**Statement.** Even with `PRIVY_APP_SECRET` + `PRIVY_AUTHORIZATION_KEY` leaked, no player wallet USDC can leave except as a capped, consented deposit to that player's own Tilt ledger.
- Enforced today: one Privy policy rule, ALLOW method `signTransaction` iff every instruction's `programId == Tilt` (`apps/wallet/scripts/privy-setup.ts:59-66`), owned by an offline admin quorum. Relay caps (INV-38) apply only to transactions the relay itself builds.
- Second barrier: none if the policy admits a transaction.
- GAP (lead, verify): `fund_vault`, `fund_promo` and an uncapped `deposit` are Tilt instructions the player can sign as funder/payer (INV-15), so a program-id-only policy admits them. Impact **per capability** (let `severity.md` rate it):

| Attacker holds | What they can do to delegated wallets | Money bound |
|---|---|---|
| Privy creds alone | sign `deposit` (credits the player's **own** ledger: no loss, but bypasses consent, relay caps and api RG limits, INV-37/38/49); sign `fund_vault` (player USDC → house bankroll) or `fund_promo` (→ promo pool). The attacker gains nothing directly. | players lose up to every delegated wallet's USDC balance to the house/pool; attacker gain 0 |
| Privy creds + relayer key (same relay process env: a relay host compromise) | `fund_promo` from victims, then `pay_promo` to any ATA of the mint (`C/instructions/promo.rs:163`) | `PromoConfig.max_payout` per payout, `daily_cap` per 24 h block (2x around a boundary), plus what the pool already holds |
| Privy creds + admin key | `fund_vault` from victims, then `withdraw_house` (free funds) | every delegated wallet's balance |

- Privy bypass hypotheses (TRUST: Privy policy engine; verify in the Privy docs via Context7 and in the test plan, never live): is every method other than `signTransaction` denied by default, in particular `signMessage` over the serialized transaction message bytes (a valid signature for that transaction that sidesteps the `programId` condition) and `signAndSendTransaction`? How is `programId` resolved for v0 transactions with address lookup tables? Do CPIs / inner instructions matter? What does an empty `policyIds` on `addSigners` mean (INV-54)? Docs (from research notes): https://docs.privy.io/controls/policies/overview, https://docs.privy.io/controls/authorization-keys, https://docs.privy.io/recipes/wallets/conditional-signer-policies.
- Also (INV-54): the policy is attached per wallet from an api response; the relay never checks that a wallet's signer carries `PRIVY_POLICY_ID` before using it (`W/players.ts`).
- **HUMAN-ONLY (Armand).** `apps/wallet/test/privy.live.ts` needs real Privy secrets (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, header `:1-9`), defaults `ANCHOR_WALLET` to `~/.config/solana/id.json` (`:36`, likely the real admin key), can target devnet (`BASE_RPC`), and calls the live `privy.policies().update(...)` (`:110-113`). Agents must not run or edit it, must not read any `PRIVY_*` value, and stay off devnet. Agents only write (a) the test plan: the list of transactions the policy must refuse (`fund_vault`, `fund_promo`, oversize `deposit` signed by the player; player as fee payer; ComputeBudget + Tilt mix; `signMessage` of a Tilt+SPL message; `signAndSendTransaction`; v0 + ALT hiding an SPL `transfer`), and (b) an offline unit test against a mocked policy evaluator, in a worktree. A live run is done by Armand with a throwaway Privy dev app, the local stack and a throwaway `ANCHOR_WALLET`. On-chain fix candidates (restrict `fund_*` funders, cap `deposit`) belong to Armand.
- Coverage: `privy.live.ts` (manual, not in CI) refuses a raw SPL transfer and a deposit + transfer mix (`:101-108`) and checks the relay key cannot edit the policy. Nothing for `fund_*`, `signMessage`, v0/ALT.
- Status: GAP (HUMAN-ONLY live test).

### INV-42 Win-cap raises are exact and only for staking moves
**Statement.** The relay raises `max_win` only when a staking move's simulation fails with `WinCapReached`, by exactly `short − (ledger.maxWin − seen.maxWin)` > 0, at most once per submit, never for a move that stakes nothing.
- Enforced: `STAKING_MOVES` `W/chain.ts:49`; shortfall parse `winCapShortfall` `:127-133` (log `"Win cap short by "` emitted at `C/state.rs:364`); retry in `play` `:311-325`; raise `raiseWinCap`/`sendRaiseWinCap` `:332-358`.
- Second barrier: on-chain bound per raise: `max_round_gain`, `free` (INV-11).
- Trust: simulation logs come from the RPC: a lying RPC can claim a huge shortfall (the program still caps each raise).
- Test: present (see coverage); add a property: raised total ≤ Σ legitimate shortfalls.
- Coverage: `reads by how much the program found the move past the cap`, `raises the cap on Solana by exactly the shortfall, waits for the rollup, then sends the move again`, `never raises the cap again for a raise the rollup has not seen yet`, `raises only what Solana's cap lacks when the rollup lags a smaller raise`, `never raises the cap for a move that stakes nothing`.
- Status: OK (the bankroll-lock risk is INV-11; the relayer cost is INV-65).

---

## F. Contract (`packages/contract`, shared: changes need both founders)

### INV-43 Amounts are canonical integer strings in [1, 2^64−1] at every boundary
**Statement.** Every amount crossing mod → api → relay → program is a decimal string matching `^[1-9]\d{0,19}$` and ≤ `u64::MAX` (no sign, exponent, leading zero, whitespace, float); the web parser produces only such strings from user input (≤ 6 decimals); no float anywhere on a money path.
- Enforced: `Amount` `packages/contract/src/relay.ts:7-11` (used by api and relay schemas); web `parseAmount` `apps/web/lib/amount.ts:17-28`; mod guard amounts `^\d{1,30}$` for display only.
- Second barrier: the program's own `u64` decoding and bounds (INV-19, INV-22).
- Test: a shared table of malformed amounts through the api schema, relay schema and web parser; prop-ts round-trip `formatAmount(parseAmount(x))`.
- Coverage: `accepts positive integers in base units up to u64`, `refuses what the program could misread` (`packages/contract/src/relay.test.ts`); `apps/web/test/amount.test.ts`.
- Status: OK.

### INV-44 IDL and PDA helpers match the program
**Statement.** `packages/contract/src/idl` equals what `anchor build` produces; every PDA helper in `program.ts` equals the program's seeds; zod `Action` bounds are within the program's own validation (a zod-accepted action is never one the program would misinterpret).
- Enforced: CI `sync-idl.sh && git diff --exit-code` (`.github/workflows/chain.yml:85-88`); `program.test.ts` seed checks; dice `superRefine` and per-game bounds in `relay.ts`.
- Second barrier: on-chain seeds constraints (a wrong PDA fails, it does not misroute).
- Test: differential: every action accepted by zod is accepted (or refused with a game error, never misdecoded) by the program on the local stack.
- Coverage: `program.test.ts` (`derives the table the program expects on every blackjack move`, per-game seed tests), `relay.test.ts` (`refuses bets the program would reject`).
- Status: OK.

---

## G. API (`apps/api`, Eli's zone)

### INV-45 Session scope: the mod token only plays; one device code yields one session; token types are not confusable
**Statement.** A mod token authenticates only if `sha256(token)` exists with `scope='play'`, not revoked, not expired, and only on mod routes; it never authenticates `/v1/account/*` or approve. A Privy token never authenticates mod routes. An identity token is never accepted where an access token is expected and the reverse; a token of another Privy app (`aud ≠ appId`) is refused for both kinds. A device code yields at most one session; a user code is approved at most once; polls are ≥ 5 s apart; approve attempts per user are capped before validation.
- Enforced: `TOKEN_FORMAT` `A/auth/sessions.ts:9`, `authenticate` `:34-49` (query `:36-38`); DB `CHECK (scope = 'play')` `A/db.ts:65`; `modAuth` `A/http.ts:112`, `webAuth` `:123` (`verifyAccessToken` `:125`), consent `verifyIdentityToken` `:145`; verifier `A/privy.ts:32-40` delegates `typ`/`aud`/`iss` checks to the `@privy-io/node` SDK (research note: the SDK checks `typ`, ES256, `iss`, `aud = appId` for both kinds; lead, verify at the pinned version); `iat` is read by hand after verification (`A/privy.ts:18-23`). Device poll `FOR UPDATE` + `consumed` `A/auth/device.ts:56-76`; approve `WHERE status='pending' AND expires_at > now()` `:86`; `approveAttempts` taken before the check `A/routes/auth.ts:31`.
- Second barrier: the relay re-verifies the identity token for money moves (INV-37); a mod token cannot carry a money action (INV-46).
- Holes: 30-day opaque token, no rotation (spec §10.5 asks short + refreshable); device-code phishing gives the attacker a play token on the victim's balance (cannot withdraw); `approveAttempts` is in memory per instance and resets on deploy; the api holds `PRIVY_APP_SECRET` although verification needs no secret (research G-A6: blast radius if the api leaks, INV-66).
- Test: auth matrix every route × {none, mod token, access token, identity token, expired, revoked, other Privy app}; race approve/poll.
- Coverage: `cannot be used on web routes: a mod token never moves money`, `approves a code once when two players race for it, and issues one session`, `caps wrong codes sent in parallel too`, `asks the mod to slow down when it polls faster than the interval`, `expires codes after ten minutes, even approved ones`, `are listed and revoked from the web, and a revoked token stops working` (`apps/api/test/auth.test.ts`). Nothing tests token-type confusion or another app's token (the suites inject a fake verifier).
- Status: OK-untested (token type / aud); else OK.

### INV-46 The mod path can never carry a money action
**Statement.** No input to `POST /v1/play` makes the relay receive `open_account`, `deposit`, `withdraw` or `promo_payout`.
- Enforced: `PlayActionSchema` (strict union of game moves) `A/schemas.ts:54-139`, typed against `@tilt/mod/protocol`.
- Second barrier: the relay requires consent for money actions (INV-37).
- Test: prop-ts: arbitrary JSON bodies ⇒ the relay fake never sees a money action type.
- Coverage: `refuses money actions and malformed moves without calling the relay` (`apps/api/test/routes.test.ts:133`).
- Status: OK.

### INV-47 api intent ids are bound to (user, action); no IDOR
**Statement.** A lowercased `intent_id` is bound forever to one `(user_id, action)`; another user or action ⇒ `INTENT_CONFLICT`. At most one relay `submitIntent` per id per process at a time. Intent status and session listing/revocation return only the caller's own rows. A replay returns the recorded outcome even if a limit now applies (the guard runs only on a fresh insert).
- Enforced: `record` `A/intents.ts:112-139` (`ON CONFLICT DO NOTHING` `:120`, guarded insert under `pg_advisory_xact_lock(GUARD_LOCK, hashtext(userId))` `:123-129`, conflict `:136-137`); `inflight` map `:53,69-72`; `status` scoped `:76-86`; sessions `A/auth/sessions.ts:51-72` (`WHERE id AND user_id`).
- Second barrier: relay replay binding (INV-34).
- Holes (lead): the api deletes its pending row on relay `INTENT_CONFLICT`/not-recorded refusals (`A/intents.ts:163-164`) and on stale-unknown (`:85`), so a later-landing relay intent stops counting toward the api daily deposit limit (INV-49). Across api instances, dedupe relies on relay idempotency (INV-34).
- Test: race: 50× same id in parallel ⇒ one relay call; id case variants; another user's id ⇒ 404/null.
- Coverage: `sends one relay intent when the same intent is replayed in parallel`, `refuses to reuse an intent id for another action`, `returns the player's intent and hides other players' ones`, `a retried bet returns its outcome even once the loss limit it caused is reached`.
- Status: OK.

### INV-48 Player intent ids cannot squat prize payout ids
**Statement.** A player-chosen intent id can never collide with a promo payout id, at the api or at the relay; a prize can never be blocked, marked failed or marked paid because of a player intent.
- Current state: prize ids are `uuidv5(PRIZE_NAMESPACE, "<compId>:<kind>:<rank>")` (`A/competitions/uuid.ts:23-26`) with a public namespace and public competition ids (`GET /v1/leaderboard`); the relay uses **one** `intent_id` namespace for player intents and promo payouts (`W/app.ts:115` `intentId: payoutId`), and `get(id, promo)` filters by kind (`W/intents.ts:147-153`). A player can send `/v1/play` with `intentId = prizeId` before close ⇒ relay `INTENT_CONFLICT` at pay time ⇒ `getPromo` 404 ⇒ the prize stays `approved` forever (`A/competitions/payouts.ts`).
- Second barrier: none (the on-chain `PromoPayout` PDA is never reached).
- Fix directions (not applied in a hunt; cross-zone, relay is Armand's): separate namespaces at the relay, a server secret in the uuidv5 name, or refuse non-v4 ids on player routes.
- Test: regression: compute a prize id, submit it as a play intent, close + approve + pay ⇒ the prize must still be paid exactly once.
- Coverage: none.
- Status: GAP (lead, verify with a PoC).

### INV-49 Responsible-gaming limits fail closed; withdrawals are never blocked
**Statement.** Self-exclusion never shortens (`excluded_until` only grows); lowering a limit is immediate, loosening waits 24 h; Σ accepted deposits (non-failed, 24 h) ≤ the player's daily deposit limit under concurrency; a bet is refused once the daily loss reaches the limit; exclusion, limits and geo never block a withdrawal.
- Enforced: `GREATEST` on `excluded_until` `A/limits.ts:140`; `blockReason` `:154-169`; deposit sum `:181-189` under the guard lock (INV-47); `dailyLoss` `:171-178`; the withdraw route has no guard and no geo (`A/routes/web.ts:109-110`).
- Second barrier: none; limits and exclusion live only in the api (a player or attacker who reaches the relay or program another way bypasses them, e.g. INV-41).
- Holes: `dailyLoss` sums **indexed** rounds only ⇒ fails open while the indexer lags or truncates (INV-52).
- Test: race: limits vs deposits, exclude vs pending bet; indexer-lag fixture ⇒ bet refused (after fix).
- Coverage: `self-exclusion blocks play and deposits, not withdrawals, and cannot be shortened`, `the daily loss limit stops new bets but lets the hand finish`, `the daily deposit limit holds against parallel deposits`, `lowers limits at once and raises them only after 24 h`, `withdrawals are never geo-blocked: players can always take their money out`.
- Status: PARTIAL.

### INV-50 Every endpoint is rate limited by a key the attacker cannot mint
**Statement.** Every route (api, relay, web route handlers) is behind a limiter keyed on something the attacker cannot cheaply multiply (session, user, real client IP), and one client cannot exhaust a global bucket for others.
- Enforced (api): per-IP then global (`A/app.ts:49-53`; a refused IP never spends a global token); per-session/user/auth/play/money buckets (`A/main.ts:36-46`); `money` on deposit/withdraw (`A/routes/web.ts:87`); approve attempts (`A/routes/auth.ts:31`). Client IP from the right of XFF only with `TRUST_PROXY` (`A/http.ts:37-45`).
- Second barrier: the api limiters stand in front of the relay; nothing behind them.
- Holes: `/health` is before every limiter and hits the DB (`A/app.ts:44`, deliberate); buckets are in memory, per instance, reset on deploy (`A/ratelimit.ts`); IPv6 keys are full addresses (a /64 rotates freely); `prune()` is O(n) above 10k keys (CPU DoS lead); the relay has **no** limiter (a leaked relay key or a compromised api has no brake, INV-65/66); the web waitlist keys on the **leftmost** XFF (`apps/web/app/api/waitlist/route.ts:19`).
- Test: vitest: spoofed XFF with `TRUST_PROXY` on/off; IPv6 same /64; flood vs global; bucket map growth.
- Coverage: `never lets more through than capacity plus refill` (fast-check, `units.test.ts:48`), `never lets one flooding IP exhaust the global limit for others`, `takes the address our proxy appended, never the client-written leftmost one`, `is rate limited per player`.
- Status: PARTIAL (relay has none).

### INV-51 Prizes stay within pool and budget, go to eligible winners, are paid once, and only after approval
**Statement.** Σ(pool + drop_pool) per campaign ≤ budget × (1 − commission); Σ rank prizes ≤ pool, Σ drops ≤ drop_pool, each > 0; a rank prize goes only to a player with net > 0; at most one drop per player; tickets per player per clock hour ≤ `tickets_per_hour`; the ranking net counts every round in the window (`min_stake` only gates eligibility and tickets); a competition closes once, not before `ends_at`, and not before `indexed_through ≥ ends_at` unless forced and audited; only `approved` prizes are sent; each prize id pays at most once across concurrent or crashed runs; the drop seed stays secret until close and matches its published hash.
- Enforced: budget check under `FOR UPDATE` on the campaign `A/competitions/store.ts:208-248` (lookup `:213`); close `FOR UPDATE OF c` + gates `:278-289`; prize insert `ON CONFLICT (id) DO NOTHING` `:298-305`; `splitPool` `A/competitions/prizes.ts:7-17`; rank eligibility `p.net > 0n` (`prizes.ts:35`); `capTickets` per player per hour (`A/competitions/drops.ts:26-35`); `drawWinners` one drop per player (`drops.ts:42-53`); DB `CHECK (amount > 0)`, `CHECK (tickets_per_hour > 0)`, `UNIQUE(competition_id, kind, rank)` (`A/db.ts:178,196,205`); pay claim lease `UPDATE … WHERE status='approved' AND (pay_started_at IS NULL OR < now() − 5 min)` (`A/competitions/payouts.ts:84-86`); seed hidden `A/competitions/store.ts:75`.
- Second barrier: relay replay per payout id + promo caps (INV-34, INV-38); on-chain `PromoPayout` PDA per id (INV-14).
- Holes (leads): `payPrizes` pays the stored `prizes.amount`/`user_id` with **no pay-time recheck** against pool or standings ⇒ a DB write = an approved prize to anyone, up to relay caps; `prize:approve --competition` bulk-approves rows added after review; the admin identity is a self-declared `ADMIN_ACTOR` and `audit_log` is mutable by the same DB role; the drop seed is plaintext in the DB (`A/db.ts:180`); `close` uses the app clock (`store.ts:282`); ranking and drops are sybil lotteries (EV sim needed vs the onboarding fee); id squatting is INV-48.
- Test: race: concurrent `prize:pay` runs (present); property: Σ paid per competition ≤ pool + drop_pool at pay time; prop-ts on `capTickets`/`drawWinners` (≤ perHour, ≤ 1 per player); sybil EV Monte-Carlo vs onboarding fee.
- Coverage: `keeps the pools within the campaign budget after commission`, `closes once: ranks and drops become prizes under review, and the seed is revealed`, `refuses to close before the indexer has caught up with the end, unless forced`, `pays only approved prizes, each exactly once, even with concurrent runs`, `asks again with the same id when a payout is still pending, and never re-issues it`, `never pays more than the pool` (fast-check).
- Status: GAP (pay-time recheck, admin plane); else OK.

### INV-52 `indexed_through` means every round settled before it is indexed; draws come only from callbacks
**Statement.** The indexer advances `indexed_through` only after a run that saw every signature since the cursor; `rounds` is unique on `signature` and `(player, round)`; draws are decoded only from instructions whose `programId == PROGRAM_ID` and whose name is in `CALLBACKS` (top level or CPI); a round's `detail` is written once and only when `(player, round, request_id)` match. Prizes and loss limits that read `rounds` are only as correct as this.
- Enforced: uniqueness `A/db.ts:105`, idempotent re-processing (`A/rounds.ts`); `CALLBACKS` `A/indexer.ts:27`, filter `:134-152`; write-once `detail` `UPDATE … WHERE player AND round AND request_id AND detail IS NULL` (`A/rounds.ts:80`); `indexedThrough` after backfill `A/indexer.ts:344`.
- Second barrier: none; the spec says no payment is decided on the index (§10.2), yet prizes are.
- GAP (lead, verify): backfill stops after `MAX_PAGES` pages (`A/indexer.ts:42,324-332`), logs "backfill truncated; older signatures skipped", then still advances the cursor and `indexed_through` (`:337-345`) ⇒ missing rounds pass the competition close gate and under-count `dailyLoss`. Live-feed rounds get `settled_at = new Date()` (api clock, `:287`), never corrected by backfill. Commitment is `confirmed` on the rollup: a rollback of confirmed-not-committed txs would leave phantom rounds driving prizes.
- Test: vitest fixture with > `MAX_PAGES × PAGE` signatures ⇒ `indexed_through` must not advance; forged-RPC fixture (a non-callback instruction emitting a look-alike event is ignored; a second `detail` write is a no-op).
- Coverage: `records how far it is complete only once a backfill run has seen everything`, `indexes the live feed idempotently…`, `survives RPC failures: the next run picks up where it stopped`. Nothing on truncation.
- Status: GAP (truncated backfill).

### INV-53 No upstream or internal error text reaches a client
**Statement.** Clients see only fixed messages or an Anchor error name (`^[A-Z][A-Za-z0-9]{0,63}$`); raw relay/RPC/Postgres/Privy text goes only to server logs, and logs never contain tokens, identity tokens, device codes or secrets.
- Enforced: relay `SAFE_MESSAGES` + `ANCHOR_ERROR_NAME` `W/intents.ts:86-107`, generic `onError`; api relay mapping `A/relay.ts` and `onError` `A/app.ts`; the mod hides 5xx bodies and `cleanText`s the rest (INV-59).
- Second barrier: mod/web render text only (INV-56, INV-59).
- Test: log capture across suites: no `tilt_` token, JWT, device code, email.
- Coverage: `never returns raw internal error text` (relay), `shows Anchor error names but never raw upstream text` (api), `passes Anchor error names and hides anything else` (api units).
- Status: OK. Lead: `W/consent.ts:42` logs the Privy SDK error message (check it never echoes the token).

### INV-68 api SQL is parameterized; sponsor impressions are capped
**Statement.** Every SQL statement in `apps/api` passes values as parameters; dynamic fragments are compile-time constants only. Sponsor billing is money: impressions per `(sponsor, user, minute)` stay ≤ 60 s whatever the mod reports, and only for the sponsor of a running campaign.
- Enforced: constant fragments e.g. `LIMITS_COLUMNS` (`A/limits.ts:47-48`), `INITIAL_BET` (`A/competitions/store.ts:120-123`), the `id`/`competition_id` switch in `approvePrizes` (`A/competitions/payouts.ts:67`); impressions `CHECK (seconds BETWEEN 0 AND 60)` + PK (`A/db.ts:209-215`), `LEAST(60, …)` upsert and campaign check (`A/routes/mod.ts:82-86`).
- Second barrier: the DB CHECK on impressions; none for SQL.
- Test: `rg -n '\$\{' apps/api/src` reviewed: every interpolation inside SQL is a constant; vitest: a mod reporting 3600 s in one minute is stored as 60; sybil impressions (many play tokens) vs sponsor budget (sim).
- Coverage: `aggregates time on screen per minute for the running sponsor, capped at 60 s` (`apps/api/test/routes.test.ts:812`); no SQL lint.
- Status: OK-untested.

---

## H. Web (`apps/web`, Eli's zone)

### INV-54 The web delegates a wallet only to Tilt's relay quorum with Tilt's policy
**Statement.** `addSigners` is called only for the wallet whose address equals the player's Tilt address, only with the expected Tilt key quorum id and a non-empty policy list equal to the Tilt policy; an already-delegated wallet is checked for **which** signers it has.
- Current state: `signerId` and `policyIds` come from the `GET /v1/account` response, unvalidated (`apps/web/app/(site)/(wallet)/account/DepositPanel.tsx:101-102`); `if (wallet.delegated) return;` skips any wallet with any signer (`:100`); the web trusts API bodies as typed (no runtime validation, `apps/web/lib/api.ts`).
- Second barrier: none in the relay (INV-41). A compromised or misconfigured api, or a MITM on the API origin, attaches an attacker quorum (or an unrestricted one if `policyIds` is empty: lead, verify Privy semantics) to every new depositor.
- Test: unit: pin the expected ids as build-time constants and refuse a mismatch or an empty list; pw logged-in flow with a mocked Privy (none today).
- Coverage: none.
- Status: GAP (lead, verify).

### INV-55 Web money flow: one id per unsettled request; unknown outcome is never shown as failed
**Statement.** A double submit sends once; retrying the same amount after an unknown outcome reuses the same `intentId`; a different amount while one is pending sends nothing; "failed" is shown only on a server `failed`, a status `NOT_FOUND`, or a definitive 4xx.
- Enforced: `intentFor` `apps/web/lib/intent.ts:16-18`; `submit` `:143-159`; transient classes `:21-26`.
- Second barrier: api and relay id binding (INV-47, INV-34).
- Test: prop-ts (fast-check not yet in web): any interleaving of submit/checkAgain and API answers ⇒ ≤ 1 distinct id per unsettled request.
- Coverage: `apps/web/test/intent.test.ts` (idempotent ids, double click, unknown outcome).
- Status: OK.

### INV-56 No script injection on the money origin; waitlist input is formula-safe
**Statement.** Every HTML response carries a nonce CSP with `'strict-dynamic'`, no `'unsafe-inline'` scripts, and `frame-ancestors 'none'`; there is no HTML sink (`dangerouslySetInnerHTML`, `innerHTML`, `eval`) fed by API or user data. Rationale: any script on the origin can mint the "fresh consent" identity token silently (`useTiltAuth`) and withdraw, then sign out of the embedded wallet. Waitlist emails written to Notion never start with a formula character.
- Enforced: `apps/web/proxy.ts:29-48` (script-src `:33`), headers `apps/web/next.config.ts:4-23`; waitlist `parseEmail` refuses `= + - @` starts, whitespace, > 254 chars (`apps/web/lib/waitlist.ts:10,13-18`).
- Second barrier: withdrawals go only to the player's own ATA (INV-06); none for wallet-level signing.
- Holes: prefetch requests skip the CSP (`proxy.ts:55-57`); `style-src 'unsafe-inline'` (`:34`); no step-up (2FA/email) before withdraw (spec §10.2); the Privy SDK and its deps run with full origin privilege; waitlist rate limit keys on the leftmost XFF (INV-50).
- Test: pw CSP on every page incl. `/account`, `/connect`; grep for sinks in CI; unit table for `parseEmail` (formula starts after trim, tabs, CR).
- Coverage: `apps/web/e2e/csp.spec.ts` (`/` and `/connect`); `apps/web/test/waitlist.test.ts`.
- Status: PARTIAL; CSP OK.

### INV-57 Client-side gates are UX only
**Statement.** Every web/mod gate (geo, exclusion display, `withdrawOnly`, first-deposit minimum, wallet balance, withdraw ≤ balance, bet sizes in the mod) is re-enforced server-side (api, relay or program); removing it client-side changes nothing that matters.
- Server enforcement: geo `geoBlock` on approve, play, deposit (`A/routes/auth.ts:26`, `A/routes/mod.ts:54`, `A/routes/web.ts:91`); exclusion/limits INV-49; amounts/bets INV-19, INV-43; balance `C/state.rs:449`, `C/instructions/withdraw.rs:54-57`.
- Second barrier: by definition the server check is the barrier.
- Test: drive the api directly with each gate's forbidden input.
- Coverage: api route tests per gate (see INV-49); no systematic matrix.
- Status: OK-untested (as a matrix).

---

## I. Mod (`apps/mod`, runs inside the player's Claude Code)

### INV-58 The mod token only goes to the trusted api origin
**Statement.** The bearer token is sent only to `apiBase(apiUrl)`: https, or http on loopback (`127.0.0.1`, `localhost`, `[::1]`); links opened or shown are only `trustedVerifyUrl` results (https on the api host or its parent domain, no userinfo; loopback ↔ loopback).
- Enforced: `apiBase` `apps/mod/hooks/api.ts:28-40`; `trustedVerifyUrl` `:49-69`; `rt.base` fixed at load `apps/mod/hooks/register.tsx:1496`; logout clears token/device/state (`register.tsx:304-313`).
- Second barrier: the token is play-only (INV-45, INV-46).
- Holes (leads, verify): any https host is accepted, and the stored token is not bound to the origin that issued it: if a cloned repo's project settings or another plugin can set `pluginConfigs.tilt.options.apiUrl`, the next poll sends the token there (impact capped: play-only token); a hostile api can then serve a phishing `verifyUrl` (X3). `auth.verifyUrl` is validated once at login, then read back from shared `$.state` at render (`apps/mod/hooks/view.tsx`); the parent-domain rule is unsafe on public-suffix-like hosts (`*.vercel.app`) and with subdomain takeover (G-A4). Spec §10.6 says http only to `127.0.0.1`.
- Test: mod: `apiBase`/`trustedVerifyUrl` tables (present); add: token dropped when the base changes.
- Coverage: `apps/mod/tests/format.test.ts` (apiBase, trustedVerifyUrl), `apps/mod/tests/login.test.tsx` (off-site login page neither opened nor shown).
- Status: PARTIAL.

### INV-59 The mod never executes or relays server-controlled content as instructions
**Statement.** Every server string drawn passes `cleanText` (strips `\p{Cc}` incl. ESC/CSI and `\p{Cf}` bidi/zero-width, ≤ 200 code points); the only host command is `open <url>` in argv form with a `trustedVerifyUrl` url; the mod registers no prompt/tool/transcript hooks and never reads the user's prompts, code or tool calls (CLAUDE.md); a table `ui.message` can only press a key present in the current plan.
- Enforced: `cleanText` `apps/mod/hooks/format.ts:274-276`; `$.process.run(["open", url])` `register.tsx:319`; hooks list `register.tsx:1520-1646` (session.start, command.run tilt, config.set theme, turn.start/complete, ui.render, ui.message/fault table); table keys `register.tsx:758-777` + `isTablePost` (`apps/mod/hooks/table-input.ts`).
- Second barrier: the Claude Code mod sandbox (host); none in the mod.
- Holes (leads): `/tilt login` returns `{ text }` built from api strings (`userCode`, error text) into the transcript, which the model may read (prompt-injection channel); `isDeviceStart` does not constrain `userCode` (`apps/mod/hooks/guards.ts:446-458`); no size cap on response bodies or arrays (resource exhaustion in the host, G-A5); `cleanText` leaves U+2028/2029 and combining floods.
- Test: mod: fuzz `cleanText` and guards (no npm deps allowed in the mod: hand-rolled generators); assert the registered hook set equals an allow-list.
- Coverage: `server text cannot carry terminal escape sequences` and bidi tests (`apps/mod/tests/format.test.ts`), `tests/table.test.tsx` (malformed post), `tests/keys.test.ts` (response guards).
- Status: PARTIAL; escapes OK.

### INV-60 One move in flight; resends reuse the same id
**Statement.** At most one move is in flight per mod; network/429/5xx retries resend the same `intentId`; a new id is minted only after the previous intent is terminal or its settle timeout passed; a poll answer for an old token is discarded.
- Enforced: `sendMove` atomic `update(intent, v => v === null ? sent : v)` `apps/mod/hooks/register.tsx:527-555` (lock `:544-549`, id `:538`); `intentStep` `:557-584`.
- Second barrier: relay one-in-flight (INV-35) and api/relay id binding (INV-34, INV-47).
- Test: mod: fake api answering random sequences of network/429/5xx/pending/submitted/failed ⇒ ≤ 1 id per logical move.
- Coverage: `apps/mod/tests/play.test.tsx` (fresh uuid + token), `tests/login.test.tsx` (stale answer after logout).
- Status: OK.

---

## J. Ops, keys, supply chain and cross-cutting money rules

### INV-61 Upgrade authority and admin are under multisig before mainnet
**Statement.** No single key can upgrade the program, change roles/config, release held withdrawals without caps, or empty the free bankroll or the promo pool.
- Current state: upgrade authority = admin = one local key (Armand's `ANCHOR_WALLET`); Squads migration not done (`docs/runbook.md` "Passage de l'admin sur un multisig", `chain/README.md`; KNOWN "Une seule clé admin et d'upgrade"); `set_roles` is one-step (KNOWN L2); `chain/scripts/admin.ts` `--squads` only prints the message. No verifiable build.
- Blast radius: upgrade key = everything (vault + promo); admin = `withdraw_house` (free funds), `withdraw_promo` (whole pool), `release_withdrawals` (no caps), `set_config` (caps, validator, VRF queue, timeout), `set_roles`.
- Second barrier: none.
- Test: before mainnet, `solana program show <id>` upgrade authority == Squads vault; `vault.admin` == Squads; runbook drill (read-only checks for agents).
- Status: GAP (pre-mainnet blocker; KNOWN until then).

### INV-62 The kill switch is available in one command, always
**Statement.** Either founder can pause deposits/bets/payouts/promo in one command during a drain, and pausing cannot fail or silently revert other config.
- Current state: `chain/scripts/admin.ts` `pause|resume deposits|bets|payouts|promo|all` sends `set_config` (read-modify-write of the whole `Config`) or `set_promo` as the admin key: one key, one person; after Squads it needs multisig approval. If the stored config no longer passes `validate`, pausing fails. Pauses reach the ER only when clones refresh (INV-09). Defaults: `BASE_RPC` devnet, `ANCHOR_WALLET` `~/.config/solana/id.json` (agents: never run it against devnet).
- Second barrier: none (no pause-only guardian role; relay and api have no pause).
- Test: local-stack drill: pause each flag during in-flight rounds and withdrawals; time to effect in the ER.
- Status: PARTIAL. Idea to evaluate: a pause-only guardian role.

### INV-63 Insolvency, drains and re-roll abuse are detected and stop money automatically
**Statement.** `vault_token < reserved`, abnormal withdrawal velocity, RTP drift, expiry and failed-callback spikes (INV-27/28), promo-pool drain, low relayer SOL/escrow, relayer spend velocity (INV-65) and stuck intents are alerted to a human pager, and a circuit breaker pauses payouts automatically (spec §10.2 "Disjoncteur automatique").
- Current state: the relay monitor every 30 s emits JSON `level:"alert"` lines (`INSOLVENT`, `LOW_FREE_BANKROLL`, `LOW_RELAYER_SOL`, `LOW_ESCROW`, `STUCK_INTENTS`, `PAUSED`, `MONITOR_FAILED`; `W/monitor.ts:28-43`); no promo-pool check (KNOWN F11); no velocity, RTP, expiry-rate or failed-callback-rate alert (the sweeper counts `report.expired`, `W/sweeper.ts:53`, but nothing alerts on it); no paging pipeline in the repo; no automatic pause. Admin on-chain actions leave no off-chain named record (spec §10.7, INV-67).
- Second barrier: none.
- Coverage: `apps/wallet/test/monitor.test.ts` (`flags insolvency as critical, distinct from a thin bankroll`, `reports a failed check as a critical alert, not a silent error`).
- Status: GAP (automatic stop, expiry/velocity/RTP detection); PARTIAL (solvency detection).

### INV-64 No unreviewed code reaches CI, players or the program
**Statement.** Dependencies are pinned and install with no lifecycle scripts; CI holds no secrets and only `contents: read`; no secret is ever committed; `main` (which the mod marketplace serves to players and from which the program is built) cannot be pushed without review and green CI.
- Enforced: `pnpm install --frozen-lockfile` in every workflow; `allowBuilds` all false (`pnpm-workspace.yaml:7`); `pnpm audit --prod --audit-level high` and gitleaks full history (`.github/workflows/quality.yml`); IDL sync check (INV-44); `overflow-checks` and exact Anchor/MagicBlock crate pins (`chain/programs/tilt/Cargo.toml`); `anchor-cli` installed with `--locked` (`.github/workflows/chain.yml:82`); Claude Code pinned to `@anthropic-ai/claude-code@2.1.296` (`.github/workflows/mod.yml:26`).
- Second barrier: none for `main` (see holes).
- Holes (verify with `gh api`, read-only): `main` unprotected (free plan: branch protection/rulesets 403), no CODEOWNERS, unsigned commits; actions pinned by mutable tags and `dtolnay/rust-toolchain@master`; `curl | sh` Agave installer (`chain.yml:79`) and `cargo install --git … --tag`; the Claude Code install is version-pinned but outside the lockfile and not integrity-checked; the **Rust program builds and the absence of `cargo audit`/`cargo deny`** are the main Rust gap; `minimumReleaseAge` not pinned in repo config; `chain/scripts/local-stack.sh` mounts the whole `$HOME` rw into a floating-tag container; the mod has no tagged release flow (spec §10.6); the landing tells players to run `/plugin marketplace add ebenbaruk/Tilt` (`apps/web/components/landing/InstallSnippet.tsx:4`, research G-A3).
- Test: `pnpm install --frozen-lockfile` logs show no build scripts; `cargo audit` on `chain/Cargo.lock`; `gh api repos/{owner}/{repo}/branches/main/protection`.
- Status: PARTIAL.

### INV-65 Relayer/escrow spend per attacker unit is bounded and costs the attacker at least as much
**Statement.** Every relayer-paid tx (SOL fees, rent, VRF requests, ER txs, commits + Magic Actions paid from the escrow) is triggered by an authenticated, rate-limited action. Lifetime rent per player is bounded (one PDA per account/game seed, created only after a deposit), per-move VRF + ER cost is bounded by the api play bucket, and commit/action cost by `min_withdrawal`, the dust rule and the checkpoint cadence. For any strategy, the attacker's cost (onboarding fee, stakes lost, deposits) ≥ the relayer's spend.
- Relayer-paid sites: `open_account` inits `PlayerAccount` + `Ledger` (`C/instructions/account.rs:39-51`, payer `address = vault.relayer`); every game-PDA `init` (`C/instructions/mines.rs:30`, `table.rs:24`, likewise quick/hilo/tower/roulette); `PromoPayout` (`C/instructions/promo.rs:161`); every VRF request `invoke_signed_vrf(payer)` (`C/instructions/play.rs:140`, `mines.rs:170`, `quick.rs:153`, `hilo.rs:168`, `tower.rs:169`, `roulette.rs:155`); every ER move; each `withdraw`/`checkpoint` commit + action (escrow); each `raise_win_cap` (`W/chain.ts:347-358`); each sweeper `expire_*` (`W/sweeper.ts:51-53`) and checkpoint (`CHECKPOINT_INTERVAL_MS` default 1 h, `W/config.ts:72`). **No close instruction exists**, so rent is never recovered (KNOWN I6 for `PromoPayout`).
- Bounds today: `open_account` needs `amount > onboarding_fee` (`account.rs:63`; the fee is "what Tilt advances in SOL to open an account", doc `C/state.rs:25`); `delegate_account` needs `deposited > 0` (`account.rs:120`); game boards need a `Ledger` (e.g. `mines.rs:27-29`) and the relay opens them only on staking moves (`W/chain.ts:314-315`); api buckets `token`/`play`/`money` (`A/main.ts:36-46`, play limiter `A/routes/mod.ts:53`); `min_deposit ≥ min_withdrawal` (doc `C/state.rs:27-30`).
- Holes (leads): the relay has no limiter (INV-50), so a leaked relay key or api compromise spends without brake; `min_withdrawal = 0` is accepted by `validate` (INV-10), making each 1-unit withdrawal a commit + action; failed moves still pay ER fees and may still open a game account (`ensureGameAccount` runs before the move's simulation); sybils multiply every per-user bucket.
- Second barrier: `LOW_RELAYER_SOL` / `LOW_ESCROW` alerts (`W/monitor.ts`), log lines only.
- Test: sim: N sybils × the maximum moves, withdrawals, checkpoints and refused moves per hour allowed by the api buckets vs relayer lamports and escrow, with the attacker's cost (onboarding fee, house edge on stakes) alongside; local stack measurement of lamports per action type.
- Coverage: none.
- Status: GAP (no relay limiter, no cost simulation).

### INV-66 Each key's blast radius is bounded and has a second barrier
**Statement.** For every secret or privileged position, the money an attacker can take with it alone is bounded by a cap enforced in **another** layer, and using it leaves a trace that alerts. Mirror of INV-61 for the hot keys (sec-insider lens). Verify each row at HEAD; amounts are bounds, not estimates.

| Capability | What it can do alone | Money bound | Second barrier |
|---|---|---|---|
| Relayer key `RELAYER_SECRET_KEY` (relay env) | wager any player's balance (KNOWN, "Relais seul signataire"); `raise_win_cap` on any ledger until `free = 0` (bankroll lock, INV-11); `pay_promo` to **any** ATA of the mint (`promo.rs:163`); selective `expire_*` on its own sybil accounts (X7, INV-27); checkpoint; spend relayer SOL and escrow (INV-65) | promo: `max_payout` per payout, `daily_cap` per block (2x at a boundary) + pool balance; X7 lead (verify): sybil accounts whose `max_win` it raised itself, ground with selective expiry, are bounded by `free` and paid only at withdrawal-cap speed | on-chain promo caps (INV-14); per-player `checked_due` (INV-03); payout caps (INV-08, speed only); no alert on raises or expiries (INV-63) |
| Privy quorum creds `PRIVY_APP_SECRET` + `PRIVY_AUTHORIZATION_KEY` (relay env) | see INV-41 table | INV-41 | Privy policy only (TRUST) |
| Relay API key `RELAY_API_KEY` (api env) | every no-consent relay action: moves on any balance, promo payouts to any registered user | relay `MAX_PROMO_PAYOUT`, `DAILY_PROMO_LIMIT` (INV-38), then on-chain promo caps | relay has no limiter (INV-50); network isolation unverifiable (INV-40) |
| api host (`PRIVY_APP_SECRET`, `RELAY_API_KEY`, DB) | the relay API key row + DB write below; Privy app secret alone is not the authorization key (research G-A6: why does the api hold it?) | as the rows it contains | relay consent for money moves (INV-37) |
| api DB write | approve/pay a prize to anyone (INV-51, no pay-time recheck); mint sessions (play-only); edit limits/exclusion; edit `audit_log` | relay promo caps | relay + on-chain promo caps |
| relay DB write | remap a user's wallet (INV-39, X5: promo payouts go to the attacker); reset relay caps (INV-38); mark intents | on-chain promo caps; withdrawals stay pinned to `ledger.player` (INV-06) | on-chain pins |
| admin / upgrade key | INV-61 | everything | none (pre-Squads) |
| CI / dependency / mod marketplace push | INV-64 | everything reachable from a dev machine or the built program | none (`main` unprotected) |

- Test: one insider scenario per row on the local stack, measuring the bound; assert each use emits an alertable trace.
- Coverage: none as a matrix; `privy.live.ts` (HUMAN-ONLY) checks the relay key cannot edit the Privy policy.
- Status: PARTIAL (several rows have no second barrier or no alert).

### INV-67 Every money movement has an idempotency key and an audit record
**Statement.** Each movement of player or house money carries a unique key enforced by the layer that moves the money (CLAUDE.md: "Every money movement is idempotent (unique key) and audit-logged"), and leaves a named, append-only record.

| Movement | Idempotency key | Enforced by | Audit record | Status |
|---|---|---|---|---|
| `open_account` | `PlayerAccount`/`Ledger` PDA `init` (`account.rs:49,51`) + relay `intent_id` | chain + relay | relay/api `intents` rows; no on-chain event | OK |
| `deposit` | relay `intent_id` (INV-34) + api intent (INV-47) | relay/api only; **no on-chain key**: each landed send moves real tokens | relay/api `intents`; no on-chain event | GAP lead: a lost relay row or a second id within the 300 s consent window deposits again (credits the player's own ledger) |
| ER `withdraw` | relay `intent_id` | relay | relay/api `intents` | OK |
| `pay_withdrawals` / `apply_checkpoint` | cumulative high-water mark (INV-05) | chain | `WithdrawalPaid` / `WithdrawalHeld` (`C/withdrawals.rs:148,176`), `LossReleased` (`C/instructions/withdraw.rs:279`) | OK |
| `pay_promo` | `PromoPayout` PDA per id (INV-14) + relay intent (payout id) + api prize id and lease (INV-51) | chain + relay + api | `PromoPaid` (`promo.rs:209`); `prizes` rows; `audit_log` (mutable by the same DB role) | OK; audit PARTIAL |
| `raise_win_cap` (reservation, not a transfer) | none (relay recomputes the target from the rollup's view) | relay | none (`withoutRecord`) | lead |
| `fund_vault` / `fund_promo` | none | — | none | GAP lead |
| `withdraw_house` / `withdraw_promo` / `release_withdrawals` | none (admin) | — | no event for house/promo withdrawals, no off-chain record (spec §10.7) | GAP lead |

- Second barrier: on-chain caps and pins where listed.
- Test: for each row, replay the movement twice (same key; and, where the key lives off-chain, after deleting the off-chain row) on the local stack and assert one transfer; assert each produces a record.
- Status: GAP (deposit has no on-chain key; admin movements have no key and no record).

---

## K. Cross-layer equations (assert these in any end-to-end or simulation test)

Per player `p`, once the system is quiescent (no intent pending, all commits and actions applied):
1. **Solana ↔ ER**: `ledger.deposited == account.credited` (after a sync); `ledger.withdrawn_paid == account.withdrawn` unless a payment is held (then `account.withdrawn − ledger.withdrawn_paid` = held total, still in `reserved`); `ledger.forfeited == account.forfeited` (after apply).
2. **Tokens ↔ ledger**: tokens received by `p`'s ATA from `vault_token` == `ledger.withdrawn_paid` (e2e checks this for one player near `chain/scripts/e2e.ts:1221`); tokens sent by `p` to `vault_token` == `ledger.deposited`; tokens sent by `p` to the treasury == the onboarding fee (`C/instructions/account.rs:73-88`); so `p`'s total outflow == `deposited + onboarding_fee`.
3. **ER internal** (INV-20): `balance + open_stake + withdrawn == credited + Σ_settled(payout − stake)`.
4. **Vault token identity** (INV-13): `vault_token.amount ≥ Σ fund_vault + Σ_p ledger.deposited − Σ_p ledger.withdrawn_paid − Σ withdraw_house`, with `==` in a closed test environment (`≥` in general because anyone can SPL-transfer straight into `vault_token`). Any drift below is a bug or a theft. House P&L = `Σ_p(deposited − withdrawn_paid)`.
5. **Off-chain ↔ on-chain**: every relay intent `submitted` has a landed signature; every on-chain deposit/withdraw by the relayer has a relay intent (else a key is used outside the relay: alert). api `intents` mirror ⊆ relay `intents` (same id, user, action).
6. **Promo**: `promo.paid_total == Σ PromoPayout.amount == Σ relay promo intents submitted`; every `prizes.status='paid'` row has a `PromoPayout` PDA for its id.
7. **Relayer economics** (INV-65): relayer lamports + escrow spent over a window ≤ the sum of the per-action costs allowed by the api buckets for the active users in that window.

## L. Which invariants a change puts at risk (PR triage)

| Touched path | Re-prove |
|---|---|
| `C/state.rs` (Config, Ledger, PlayerAccount, rounds) | INV-01..04, 09-12, 16-21, 23 |
| `C/withdrawals.rs`, `C/instructions/withdraw.rs` | INV-01..06, 08, 21-22, 31-33, 67 |
| `C/instructions/account.rs`, `admin.rs`, `promo.rs` | INV-01, 02, 07, 09, 10, 13-15, 41, 65, 67 |
| `C/instructions/{play,mines,quick,hilo,tower,roulette,table}.rs` | INV-17-19, 24-29, 65 (init payer, VRF payer) |
| `C/games/*`, `C/rng.rs`, `C/settlement.rs` | INV-16, 18, 28, 30 (+ api TS ports `apps/api/src/games/*`, Rust vectors) |
| `C/constants.rs` or any delegated struct | INV-23, 44 |
| new `transfer_checked` / new instruction / new `UncheckedAccount` / new `init` | INV-13, 15, 65, 67, and the svm negative matrix |
| `W/intents.ts`, `W/db.ts` | INV-34-36, 38, 48, 67 |
| `W/consent.ts`, `W/app.ts`, `W/config.ts`, `W/main.ts` | INV-37, 40, 50, 66 |
| `W/chain.ts`, `W/players.ts`, `W/sweeper.ts` | INV-27, 28, 33, 36, 39, 42, 65 |
| `W/monitor.ts` | INV-01, 63 |
| `apps/wallet/scripts/privy-setup.ts`, web `DepositPanel.tsx` | INV-41, 54 |
| `packages/contract/**` | INV-43, 44, 46 (needs both founders) |
| `A/intents.ts`, `A/routes/*`, `A/http.ts`, `A/privy.ts` | INV-45-47, 49, 50, 53, 57, 68 |
| `A/auth/*` | INV-45, 50 |
| `A/competitions/*`, `A/indexer.ts`, `A/rounds.ts`, `A/limits.ts` | INV-48, 49, 51, 52, 68 |
| `apps/web/**` | INV-43, 54-57 |
| `apps/mod/hooks/**`, `apps/mod/.claude-plugin/*` | INV-46, 58-60 |
| `.github/**`, `pnpm-workspace.yaml`, lockfiles, `chain/scripts/*`, `docs/runbook.md`, `.claude-plugin/marketplace.json` | INV-61-64, 66 |

## M. Test backlog derived from the gaps

For `sec-poc-engineer`: regression tests written in an isolated worktree; a PoC that fails at HEAD proves the finding and stays as the regression test. Fixes are **proposed to the zone owner**, never applied by an agent. Zone: `armand` = `chain/`, `apps/wallet`; `eli` = `apps/api`, `apps/web`, `apps/mod`; `shared` = `packages/contract` (needs both founders). Ranked by money at risk.

| # | Invariant | Test | Zone |
|---|---|---|---|
| 1 | INV-41 / 15 | **HUMAN-ONLY live part.** Agents: write the refusal list (INV-41) and an offline unit test against a mocked policy evaluator. Armand runs the live check with a throwaway Privy dev app, the local stack and a throwaway `ANCHOR_WALLET`; agents never run or edit `privy.live.ts` | armand |
| 2 | INV-27 / 28 / 16 | local stack: a callback that errors ⇒ the sweeper sends `expire_*` with a new seed; distribution of outcomes after a failed first callback; expiry rate per player and game | armand |
| 3 | INV-48 | api vitest: squat a prize id via `/v1/play`, then close/approve/pay ⇒ the prize is paid exactly once (relay side needs Armand) | eli (+ armand) |
| 4 | INV-54 | web unit: refuse `addSigners` with an unexpected `signerId` or empty/unknown `policyIds` | eli |
| 5 | INV-52 | indexer vitest: a backfill > `MAX_PAGES` pages must not advance `indexed_through` | eli |
| 6 | INV-01/02/05/21/33 | LiteSVM (or Mollusk) harness with the delegation-program escrow forged via `set_account`: random interleavings of open/deposit/raise/pay (dup, reordered)/release/apply (dup)/withdraw_house over ≥ 3 players; assert INV-01..05 after each tx | armand |
| 7 | INV-11 / 66 | sim: sybil `raise_win_cap` growth vs `free` (bankroll lock cost per account); relayer-driven X7 bound | armand |
| 8 | INV-65 | sim: N sybils × max actions per api bucket vs relayer lamports and escrow; local-stack lamports per action type | armand + eli (api buckets) |
| 9 | INV-32 | svm: forged committed `PlayerAccount` bytes (other player, `credited > deposited`, max `withdrawn`) ⇒ `FraudSuspected` | armand |
| 10 | INV-15 | svm negative matrix per instruction × account slot × signer (generated from `packages/contract/src/idl/tilt.json`) | armand |
| 11 | INV-16 / 28 | proptest over every game and `settle`: arbitrary randomness × reachable states ⇒ no panic, `gross ≤ stake + max_gain`; CU measurement on the local stack | armand |
| 12 | INV-67 | replay each money movement after deleting its off-chain row (deposit) on the local stack | armand |
| 13 | INV-20 | proptest shadow ledger over random op sequences on `PlayerAccount` | armand |
| 14 | INV-25 / 29 | negative tests: `consume_*` from a plain wallet; every other move while `AwaitingDraw` for hilo/tower/blackjack/roulette/quick | armand |
| 15 | INV-23 | golden layout test for `BlackjackTable` | armand |
| 16 | INV-27 / 10 | proposal to Armand: a minimum `round_timeout_secs` and an upper bound on `max_round_gain` in `validate`; regression test `RoundNotExpired` | armand |
| 17 | INV-39 | fast-check in the relay: compiled account keys ⊆ allowed set, fee payer == relayer, for arbitrary actions | armand |
| 18 | INV-45 | api auth matrix with real token shapes: other Privy app, identity token on an access route and the reverse | eli |
| 19 | INV-49 | the loss limit refuses bets while `indexed_through` is stale (after fix) | eli |
| 20 | INV-50 | XFF / IPv6 /64 rate-limit tests (api, web waitlist); relay limiter (proposal to Armand) | eli (+ armand) |
| 21 | INV-36 / 38 | fake RPC reporting `expired` for a landed deposit ⇒ quota not released (after fix) | armand |
| 22 | INV-43 / 44 | shared malformed-amount table across api schema, relay schema and web parser | shared |

Commands, local stack only (rules of engagement: never devnet writes, never mainnet, throwaway `ANCHOR_WALLET`): see `poc-recipes.md` and `docs/dev.md`.
