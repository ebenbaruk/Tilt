# Tilt threat model

Pointers verified at `d559a31` (2026-10-19). Shorthands: `P/` = `chain/programs/tilt/src/`, `W/` = `apps/wallet/src/`, `A/` = `apps/api/src/`, `WEB/` = `apps/web/`, `MOD/` = `apps/mod/`.

**Read first**
- **Rules of engagement**: follow SKILL.md "Rules of engagement". Local stack only for anything that sends a transaction or calls Privy. **Never run** `chain/scripts/admin.ts` (defaults `BASE_RPC` = devnet, `ANCHOR_WALLET` = `~/.config/solana/id.json`, likely the real admin/upgrade key, `admin.ts:43-46`), `chain/scripts/e2e.ts` (any flag; `--shared-vault` rewrites a shared vault's config, guard at `e2e.ts:691`), `apps/wallet/scripts/privy-setup.ts` (creates Privy policies and key quorums), `apps/wallet/test/privy.live.ts` (live Privy app, attempts `policies().update`), or `apps/wallet/test/relay.e2e.ts` against devnet/mainnet. Never read key files or `.env*` values.
- **Zones**: findings in `chain/` and `apps/wallet` are reported to Armand with a PoC and never edited by the auditor; nobody edits the other founder's zone; `packages/contract` needs both.
- **Size**: about 50 KB, meant to fit one Read. If a Read stops early, continue with `offset` until §8: §6-§8 hold the spec table, the canonical X chains and the known items.
- **This file is guidance, not evidence.** If the code at the target commit contradicts it, the code wins and the contradiction is worth recording. Comments asserting safety ("checked upstream", "audited") are claims to verify, never a guard. Attackers read this file too.
- **Pointers rot.** If a line moved, re-anchor by the symbol named next to it (`rg -n 'fn checked_due' chain/`); if the symbol is gone, treat every leaf citing it as unverified.
- **Tags**: `[lead]` = hypothesis to verify; `[check]` = believed to hold, prove it with a test; `[known]` = in §8 (re-verify, do not re-report unless the code changed or the impact is larger). No severity is stated here on purpose: rate with `severity.md` on demonstrated impact (privileged preconditions per its §3 ladder).
- **Ids** are local to this file: `A*` assets, `T*` actors, `B*` boundaries, `X*` cross-layer chains (canonical here), `TL*` top leads. Prior-audit ids are prefixed by the audit date (`2026-10-13:L2` = `docs/audits/2026-10-13-chain-relay.md` row L2). Labels like `H-1`, `api H1`, `G-A2` seen in other files come from unshipped scratch maps: do not cite them as references.

---

## 0. Using this file

### 0.1 Per lens (exact tokens sent by the workflows)

- `checklist`: walk §4 hop by hop for your layer; every "Checks" cell is a claim to prove at HEAD with a quote or a test.
- `attacker-goal`: start from §0.2, then a §5 tree leaf by leaf, then the §7 chains. Report dead ends with the blocking `file:line`.
- `invariant-breaker`: turn each `[check]` leaf into a property or concurrency test (`invariants.md`, `poc-recipes.md`).
- `insider` (`Assume:` line): find your actor in §2, enumerate "Reaches directly", then ask whether the second barrier is independent (other key, other host, on-chain).
- `differential`: map the diff onto §3-§4; for each touched boundary re-check its §3 row and the §6 row; a change that makes a P/N row worse is a finding candidate.
- Refuters: `code-truth` / `exploitability` use §3 "what the receiver must re-check" and the §2 "Reaches directly" column to decide who controls each input. `impact` uses §1 "Worst case" and "Primary guard". Blast radii in §2 are hypotheses, not proof.

### 0.2 Top leads by expected value (cheapest likely-real first)

| Id | Lead | Asset | Cheapest attacker | Pointer | Owner agent | Fastest proof |
|---|---|---|---|---|---|---|
| TL1 | Prize-id squatting: public deterministic prize id used as `/v1/play` `intentId` freezes the prize (X6) | A4 | T2 player | `A/competitions/uuid.ts:23-26`, `W/app.ts:115`, `W/intents.ts:150` | sec-api, sec-relay | vitest + PG (api + wallet) |
| TL2 | Callback failure -> visible randomness -> sweeper `expire_*` re-roll (X1) | A1 | T2 player | `P/instructions/play.rs:279` (`expire_round`), `W/chain.ts:364` (`expireRound`) | sec-chain-rng | cargo test (panic search) + static |
| TL3 | Relay quorum attached with api-chosen `policyIds`, relay never checks policy (X2) | A6 | T6/T15 api or web origin | `WEB/app/(site)/(wallet)/account/DepositPanel.tsx:100-102`, `W/players.ts:29` (`find`) | sec-web, sec-relay | static + Privy dev app |
| TL4 | Player-signed `fund_vault`/`fund_promo` pass a `programId == Tilt` policy | A6 | T7 Privy creds | `P/instructions/admin.rs:78-106`, `P/instructions/promo.rs:117-147`, `apps/wallet/scripts/privy-setup.ts:54-64` | sec-insider | static; live only on a throwaway Privy dev app |
| TL5 | Bankroll lock: sybils trigger auto `raise_win_cap`, never lowered | A3 | T4 sybil | `P/state.rs:124` (`raise_win_cap`), `W/chain.ts:323` (`play`) | sec-chain-economics | cargo test + cost model |
| TL6 | Prizes decided on the `confirmed` index (phantom rounds, truncation, api clock) | A4 | T2/T16 | `A/indexer.ts:287` (`subscribe`), `:330-344` (`newSignatures`), `A/competitions/store.ts:271-315` | sec-api | vitest + PG |
| TL7 | Withdraw Magic Action made to fail by the player (closed/frozen ATA) | A1/A2 | T2 player | `P/instructions/withdraw.rs:108`, `P/withdrawals.rs:157`, `W/chain.ts:621` | sec-chain-rollup | local stack |
| TL8 | Admin key = full promo pool in one tx (`set_promo` + `set_roles` + `pay_promo` to any account) | A4 | T12 | `P/instructions/promo.rs:110,163`, `P/instructions/admin.rs:66` | sec-insider | cargo/LiteSVM |
| TL9 | Withdrawal window gaming (player-chosen block start + held amounts paid at once) | A1 | T4 sybil | `P/withdrawals.rs:35-38` (`Window::rolled`) | sec-chain-economics | cargo test |
| TL10 | Rent farming: boards opened before simulation, `PromoPayout` never closed | A5 | T4 sybil | `W/chain.ts:314` (`play` -> `ensureGameAccount` `:394`) | sec-relay | vitest + local stack |
| TL11 | `apiUrl` override steals mod token -> phishing (X3) | A8/A9 | T13 | `MOD/hooks/api.ts:31-37`, `MOD/hooks/register.tsx:1496` | sec-mod | static |
| TL12 | Daily loss limit fails open on indexer lag | A2 (RG) | T2 player | `A/limits.ts:154-178` (`blockReason`) | sec-api | vitest + PG |

### 0.3 Triage any candidate

1. Which asset (A*) moves, and who loses (players, house, sponsor)?
2. Which actor (T*) and precondition (money, keys, accounts, timing)?
3. Which boundary (B*) is crossed without its §3 re-check?
4. What stops it on-chain today (`checked_due`, caps, seeds, signer), and is that barrier independent of the one bypassed?
5. Is it in §8? If so, what is new?

---

## 1. Assets

| ID | Asset | Where | Moved out by (code) | Primary guard | Worst case |
|---|---|---|---|---|---|
| A1 | **Vault USDC** (deposits + bankroll) | `vault_token` PDA, authority `vault` | `pay_withdrawals` (Magic Action, `P/instructions/withdraw.rs:129`); `release_withdrawals` (admin, no caps, `:169`); `withdraw_house` (admin, free part, **to `vault.treasury` only**, `P/instructions/admin.rs:116,128-130`) | `checked_due` (`P/withdrawals.rs:13`), `reserved`, block caps (`:68`), upgrade key | Player funds lost; insolvency |
| A2 | **Per-player claim** | `Ledger` `["ledger", player]` (Solana only); `PlayerAccount` `["account", player]` (ER) | Relayer-signed ER moves; Solana re-check in `pay_due` (`P/withdrawals.rs:120`) | `address = vault.relayer`; `checked_due`/`checked_forfeit` (`:187`) bound to `deposited - forfeited + max_win` | Balance played away, frozen, misdirected |
| A3 | **Reserved bankroll** | `Vault.reserved` | Grows: `open_account`/`deposit` (`P/instructions/account.rs:91,169`), `raise_win_cap` (`P/state.rs:124`). Shrinks: `pay_due`, `apply_checkpoint` (`P/instructions/withdraw.rs:278`) | `free >= max_win`, `amount <= max_round_gain` | House locked out, or under-reserved |
| A4 | **Promo / prize pool** | `promo_token` PDA | `pay_promo` (relayer, **any token account of the mint**, `P/instructions/promo.rs:163,170`); `withdraw_promo` (admin, to treasury only, `:225,239`) | On-chain per-payout + block caps (`set_promo` checks only `max_payout > 0 && daily_cap >= max_payout`, `:24-30,110`), `PromoPayout` PDA per id; relay `MAX_PROMO_PAYOUT`, rolling-24 h `DAILY_PROMO_LIMIT` (`W/config.ts:62-66`) | Pool paid to attackers |
| A5 | **Relayer SOL + MagicBlock escrow** | relayer account; `escrowPdaFromEscrowAuthority(relayer)` | Every relay tx, rents (accounts, boards, `PromoPayout`, ATAs), raises, sweeper, Magic Actions | Rate limits, onboarding fee (USDC); `LOW_RELAYER_SOL`/`LOW_ESCROW` log only (`W/monitor.ts:48-51`) | Exits stall; SOL drained |
| A6 | **Player Privy wallets** | Privy TEE; relay key quorum added by the web | Player session; relay key under policy `programId == Tilt` (`apps/wallet/scripts/privy-setup.ts:54-64`) | Policy (admin quorum), consent on money intents | Wallets emptied into vault/pool |
| A7 | **Admin + upgrade authority** | One hot keypair (`ANCHOR_WALLET`); Squads planned | `set_config` (`P/instructions/admin.rs:58`), `set_roles` (`:66`), `set_promo`, `release_withdrawals`, treasury withdrawals, upgrade | Custody only; no timelock or config ceiling | Upgrade = all; else §5.7 |
| A8 | **Mod tokens** (30 d, play-only) | Mod `$.store` `session` (`MOD/hooks/register.tsx:142`); `mod_sessions.token_hash` | `/v1/play`, `/v1/state`, `/v1/intents`, `/v1/impressions` | Scope `play` (DB CHECK), revocable | Victim's balance wagered |
| A9 | **Privy web session + identity token** | Web origin storage | Deposit/withdraw (`A/routes/web.ts:91,110`), approve, limits, `addSigners` | CSP (`WEB/proxy.ts`), consent age (`A/http.ts:142` `requireConsent`, `W/consent.ts:46`) | Withdraw then transfer out |
| A10 | **Off-chain state** (intents, limits, sessions, competitions, prizes, `audit_log`, `drop_seed`, relay `players`) | each `DATABASE_URL` | Any DB writer; admin CLI (`A/admin.ts:136` `ADMIN_ACTOR`) | Chain final for money; CHECKs; advisory locks | Prize theft, caps reset, wallet remap |
| A11 | **Secrets**: `RELAY_API_KEYS`, `RELAYER_SECRET_KEY`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_ADMIN_KEY`, `EDGE_SECRET`, `NOTION_TOKEN` | Host env; `~/.config/tilt/relay.env(.admin)` from `privy-setup.ts` | §2 | Rotation runbook (`docs/runbook.md:35-39`) | §2 |
| A12 | **Repo, CI, deploy** | GitHub (`main` unprotected; remote `prod` ahead of `main`), Vercel, DNS | Push to `main` ships the mod (`.claude-plugin/marketplace.json` `./apps/mod`) and the next program build | gitleaks, `pnpm audit` | Malicious mod/web/program |
| A13 | **Players' machines** | Claude Code host | `$.http.fetch`, `$.process.run(["open", url])` (`MOD/hooks/register.tsx:319`) | `trustedVerifyUrl` (`MOD/hooks/api.ts:49`), `cleanText` | Token theft, prompt injection, phishing |
| A14 | **Fairness / reputation** | — | Re-rolls, impression fraud, Circle freeze | VRF + `request_id`, prize review | Business-ending |
| A15 | **User PII** (emails, user->wallet map, waitlist) | api `users`, relay `players`, Notion DB (`WEB/lib/waitlist.ts:26` reads `NOTION_TOKEN`) | DB readers, token holder | Server-only token, DB creds | Targeting of depositors, GDPR |

---

## 2. Actors and capabilities

"2nd barrier" = independent control still holding if the first fails (spec §10.1). Blast radius = hypothesis, impact category only.

| ID | Actor | Capabilities / preconditions | Reaches directly | Blast radius if true | 2nd barrier | Agent |
|---|---|---|---|---|---|---|
| T1 | **Anonymous** | HTTP to api (`0.0.0.0:8080`, `A/config.ts:22`), web, waitlist | `/health` (unlimited, DB hit, `healthRoute` `A/app.ts:44`), leaderboard, `/v1/rounds/:sig/verify`, `/v1/geo`, `POST /v1/auth/device` | DoS; phishing setup | In-memory buckets | sec-api, sec-web |
| T2 | **Player** (N USDC) | Web money routes; mod intents; picks amounts, params, `intentId`, timing; controls own wallet (can close/empty own ATA). No ER signing, no `client_seed` (`seed`, `W/chain.ts:170`) | All games via relay; signs `deposit`/`fund_vault`/`fund_promo` itself | +EV, re-roll, cap bypass, prize squatting, forced action failure | Program | sec-chain-economics, sec-chain-rng, sec-red-team |
| T3 | **Bot farm** | Scripts both APIs; single-packet races; IPv6 /64 rotation | Limiters by IP/user/session (in-memory, reset on deploy) | TOCTOU overruns, DoS, expire timing | Advisory locks, unique indexes | sec-race-hunter, sec-api |
| T4 | **Sybil** (no KYC) | One deposit > onboarding fee each | Up to 7 rent PDAs, raises, drop tickets, per-player caps each | Bankroll lock, SOL drain, drop farming (`--min-stake` 0, `A/admin.ts:101`), cap multiplication | Fee, prize review | sec-chain-economics, sec-insider |
| T5 | **Malicious sponsor** | Display strings, funding, collusion | `cleanText` rendering, impressions (`A/routes/mod.ts:79`) | Prompt injection, impression fraud | `cleanText` (Cc/Cf only), review | sec-mod, sec-api |
| T6 | **Leaked `RELAY_API_KEYS`** / api host | All relay routes; consent only for open/deposit/withdraw (`W/consent.ts:33`) | Gamble any balance; auto raises; `POST /payouts/promo` any `userId` | Promo within relay caps; bankroll lock; house-edge losses | On-chain caps | sec-insider, sec-relay |
| T6b | **Leaked `RELAYER_SECRET_KEY`** | Signs ER moves, raises, `pay_promo`, escrow authority | Any game, seeds, `expire_*`, promo to any account (`P/instructions/promo.rs:163`) | Promo within on-chain caps; balances to house; withdrawals still to `ledger.player` | Program caps; rotation needs admin | sec-insider, sec-chain-rollup |
| T7 | **Leaked Privy creds** (app secret + authorization key) | `signTransaction` on every quorum wallet, within `programId == Tilt` | Player-signed `fund_vault` (`P/instructions/admin.rs:79,91`) / `fund_promo` (`P/instructions/promo.rs:118,132`) = irreversible transfer to house/pool. Player-signed `deposit` = cap/consent bypass, funds stay claimable | Theft from players; attacker profit only via X2 | Policy owner key; runbook :37 true but funds still leave players | sec-insider, sec-relay |
| T7b | **Leaked `PRIVY_ADMIN_KEY`** | Edit/delete the policy | Quorum unrestricted | With T7: arbitrary transfers | None | sec-supply-chain |
| T8 | **DB write** | Arbitrary rows | api: approved prize paid by `payPrizes` without pool recheck (`A/competitions/payouts.ts:129`), `audit_log`. Relay: remap `players` (`find`, `W/players.ts:29`), delete intents (caps reset) | Promo within relay caps; X5; read `drop_seed` (`A/db.ts:180`) | Withdrawals bound to `ledger.player` | sec-insider, sec-api |
| T9 | **Malicious dependency** | Runtime code (install scripts blocked, `pnpm-workspace.yaml:7`) | Privy SDK in web origin, relay process, `local-stack.sh` `$HOME` rw mount (`chain/scripts/local-stack.sh:26`) | Keys, web sessions | Lockfile, `pnpm audit` | sec-supply-chain |
| T10 | **Compromised CI / GitHub** | Push to `main`; mutable tags; `curl \| sh` | Mod players install, program source, IDL | Malicious mod; trojaned program | None (0 CI secrets) | sec-supply-chain |
| T11 | **ER validator** | Orders txs, ER clock, stale clones, commits | Delay callbacks, expire timing, stale flags | Bounded by `checked_due`; exit liveness | Solana re-checks | sec-chain-rollup |
| T11b | **VRF oracle** | Sees requests first | Bias, withhold + expire | Rigged RNG | Identity + `request_id` (`P/instructions/play.rs:307`) | sec-chain-rng |
| T12 | **Rogue admin / stolen admin key** | A7 | `set_config` (caps, pauses, `validator`, `vrf_queue`, timeout 1), `set_roles`, `set_promo`, `release_withdrawals`, upgrade. Treasury withdrawals reach only `vault.treasury`, fixed at `initialize` (`P/instructions/admin.rs:43`) | Upgrade: total. Else promo pool + free bankroll via relayer swap (5.7). Treasury owner: e2e uses the admin's ATA (`chain/scripts/e2e.ts:672`), deployed `?` | None on-chain | sec-insider, sec-supply-chain |
| T13 | **Co-installed plugin / project settings** | `$.state`; `pluginConfigs.tilt.options.apiUrl` | Token to any https host (`MOD/hooks/api.ts:31-37`; base fixed at load, `register.tsx:1496`) | Token theft; attacker `verifyUrl` | Play-only token | sec-mod |
| T14 | **Regulator / Circle** | Freeze USDC accounts | Vault, pool, player ATAs | Funds frozen; frozen ATA fails withdraw actions | None | sec-supply-chain |
| T15 | **Web hosting / Vercel / DNS / registrar** | Serve JS on the origin, change DNS, deploy any branch | Silent consent (`useTiltAuth.ts:19-21`) -> withdraw; `addSigners` with no policy (`DepositPanel.tsx:101-102`); apex = mod parent domain (`MOD/hooks/api.ts:65-66`); Privy origins | Wallets emptied; mod phishing | Privy origin list `?` | sec-web, sec-supply-chain |
| T16 | **Lying RPC** (relay, indexer) | Forge status, logs, data | False `failed` in `reconcile` (`W/intents.ts:177`) frees caps; fake shortfall (`winCapShortfall`, `W/chain.ts:127-129`) raises; phantom indexed rounds | Cap overrun, lock, prize capture (X4) | On-chain bounds; none for index | sec-relay, sec-api |
| T17 | **Audit-pipeline injection** | PR text, comments, test names, API strings | Agents' instructions | Run live scripts, mark findings safe, skip files | Rules of engagement | all |

---

## 3. Trust boundaries

| ID | Boundary | Crossing | What the receiver must re-check (and does it?) |
|---|---|---|---|
| B1 | Internet -> api | Bearer (mod token or Privy access token); identity token as consent | zod `.strict()`; in-memory rate limits (`A/http.ts:48`); geo via `x-tilt-edge` + `EDGE_SECRET` (`:56-98`); XFF vs `TRUSTED_PROXY_HOPS` `[lead]`. Token confusion `[lead]`: identity vs access token swapped; `aud == appId` for both; tokens of another Privy app (dev app, shared JWKS). Code: SDK verify (`A/privy.ts:32-38`), hand-read `iat` (`:18-22`), age [-30 s, 300 s] (`A/http.ts:136-150`) |
| B2 | Browser -> web | Privy SDK, nonce CSP (`WEB/proxy.ts`) | api JSON not validated (`WEB/lib/api.ts:139`); `addSigners` ids from the api (`DepositPanel.tsx:101-102`) |
| B3 | Mod <-> api | Bearer mod token | Mod re-guards 2xx (`MOD/hooks/guards.ts`), `cleanText`; api treats the mod as hostile |
| B4 | api -> relay | `RELAY_API_KEYS` (sha256 + `timingSafeEqual`, `authorized` `W/app.ts:35-37`); 8 KiB body (`:69`) | zod contract (`packages/contract/src/relay.ts`); consent only open/deposit/withdraw (`W/consent.ts:33`); `iat` hand-read after SDK verify (`:22-28`), **no future-`iat` bound** (`:46`), unlike the api. No rate limit, no TLS, `/health` before auth (`W/app.ts:71`) |
| B5 | relay -> Privy | App secret + authorization key | Never checks the signer entry carries `PRIVY_POLICY_ID` (`W/players.ts:29-61`) `[lead]` |
| B6 | relay -> RPC | `SOLANA_RPC_URL`, `ROLLUP_RPC_URL` | Trusts status (`reconcile`, `W/intents.ts:177`), logs (`winCapShortfall`, `W/chain.ts:127-129`), vault fields (T16) |
| B7 | ER <-> Solana | Delegation; stale clones of `Vault`/`Ledger`; commit + Magic Action | `checked_due` (`P/withdrawals.rs:13`), `checked_forfeit` (`:187`); escrow PDA signer + `escrow_auth == vault.relayer` + `this_program == crate::ID` (`P/instructions/withdraw.rs:115-125`); `read_claim` no owner check (`P/withdrawals.rs:84`). `[lead]`: does a failed action revert the commit? Which action `require!`s can the player trigger (closed/frozen `player_token`; `VaultTooSmall` `:157` reverts, never holds)? Off-repo: does the escrow PDA sign only for actions scheduled in a tx its authority signed? |
| B8 | VRF -> ER | `consume_*_randomness` | Identity signer (`#[vrf_callback]`); `pending_draw` (`P/instructions/play.rs:307`); queue pinned only to config (`address = vault.config.vrf_queue`, `:43`) |
| B9 | RPC -> api indexer | `onLogs` + backfill at **`confirmed`** (`A/indexer.ts:177-194`) | Feeds loss limits, leaderboard, **prizes**, drops; live `settled_at = new Date()` (`subscribe`, `:287`); truncated backfill advances `indexed_through` (`newSignatures`, `:330-344`) `[lead]` |
| B10 | Operator -> chain/DB | Admin keypair; `DATABASE_URL` + `ADMIN_ACTOR` | No 2-person rule, timelock or trail |
| B11 | GitHub -> players/program | Marketplace `./apps/mod`; laptop deploys | Nothing enforced; no verifiable build; remote `prod` has commits not on `main` and no CI `[lead]`: which branch do Vercel and the marketplace track? |
| B12 | Plugins/settings -> mod | `$.state`; project `apiUrl` | Shapes re-guarded; token not origin-bound |
| B13 | Vercel/DNS -> web origin | Deploy source, env (`NOTION_TOKEN`), DNS | Nothing in repo (`?`): deployers, branch, registrar 2FA, dangling apex records |

Data trust: **authoritative** = Solana `Vault`, `Ledger`, token accounts, Clock. **Bounded** = committed `PlayerAccount` (vs `Ledger`), VRF (identity + `request_id`), ER clones (monotonic + `max()` in `sync_ledger`, `P/state.rs:352-358`). **Distrust** = client fields, api->relay `userId`/action, the index, RPC, cached Privy lookups (`W/players.ts:29-35`, `A/users.ts:11`, `A/wallets.ts:9-13`), sponsor strings, repo text.

---

## 4. Flows with file references

Each hop lists the check that should stop abuse there; a missing check is a lead.

### 4.1 Game move: mod -> api -> relay -> ER -> VRF -> indexer -> mod

| # | Step | Code | Checks |
|---|---|---|---|
| 1 | Mod builds `PlayAction`, `intentId = randomUUID()`, one move in flight | `MOD/hooks/register.tsx:527-584` | Client only |
| 2 | `POST /v1/play` | `A/routes/mod.ts:51-70` | `modAuth` (`A/http.ts:112`: regex, sha256, scope `play`, not revoked); session + user buckets; `geoBlock`; game-only schema; `WAGERS` (`:16`) -> exclusion + loss limit from **indexed** rounds (`blockReason`, `A/limits.ts:154-178`) |
| 3 | Record + forward | `A/intents.ts:60-74,110-140,153-167` | `ON CONFLICT (intent_id) DO NOTHING` (`:120`); advisory lock (`:125`) **only when a guard is passed** (withdraw has none); other user/action -> `INTENT_CONFLICT`; `inflight` map (`:53`) |
| 4 | Relay `POST /intents` | `W/app.ts:91-101`, `W/intents.ts:207-238` | Key; `canonical(action)` replay compare (`:60`); per-user advisory lock (`:212`); one pending non-promo intent per user (`W/db.ts:48-49`) |
| 5 | Execute | `W/chain.ts` `play` (`:311-358`), `ensureGameAccount` (`:394-410`), `simulateRecordSend` (`:632-645`) | Cached wallet (`W/players.ts:29`); board opened **before** simulation (`:314`); auto `raiseWinCap` (`:323`); `client_seed` random (`:170`); simulate -> record -> send `skipPreflight` (`:641`) |
| 6 | ER instruction | `P/instructions/play.rs`, `quick.rs`, `mines.rs`, `hilo.rs`, `tower.rs`, `roulette.rs` | `address = vault.relayer`; seeds from `account.player`; `sync_ledger` (`P/state.rs:352`); `start_round*` (`:378-424`): `!bets_paused`, Idle, bet bounds, `max_gain <= max_round_gain`, balance, win cap (`:361`); `request_id += 1` (`P/instructions/play.rs:97`) |
| 7 | VRF callback | `consume_*_randomness` (`P/instructions/play.rs:339`, per game) | Identity signer; `pending_draw` (`:307`); kind match; `finish_round` (`P/state.rs:481`); fee `max(1% of gain, 1)` on wins (`P/settlement.rs:27`) |
| 8 | Stuck draw | `expireRound` (`W/chain.ts:364`) -> `expire_round` (`P/instructions/play.rs:279`) | `now - last_action >= round_timeout_secs` (`> 0` only, `P/state.rs:72`); same draw under `request_id + 1`, fresh seed; `PlayerTurn`/Idle cannot expire (`:302`) |
| 9 | Index + display | `A/indexer.ts` -> `rounds`; `GET /v1/state` (`A/state.ts:85`) | `Program data:` with `PROGRAM_ID` on top of stack; unique `(signature)`, `(player, round)` |

### 4.2 Deposit (web)

| # | Step | Code | Checks |
|---|---|---|---|
| 1 | Delegate wallet | `DepositPanel.tsx:91-104` | `addSigners({signerId, policyIds})` **from the api**; skipped if `wallet.delegated` (`:100`) `[lead]` |
| 2 | Consent | `WEB/components/privy/useTiltAuth.ts:19-21` | Silent `getIdentityToken()`, no 2FA |
| 3 | `POST /v1/account/deposit` | `A/routes/web.ts:91-107` | `webAuth`, `money` 6/min, `geoBlock`, consent (not bound to amount); open vs deposit from chain (`:40-50`); exclusion + deposit limit under lock |
| 4 | Relay | `W/intents.ts:247-267` | Consent re-verified; `MAX_DEPOSIT` 1,000; per-user/global **rolling 24 h** 5,000/100,000 USDC (`W/config.ts:56-60`) under `'deposits'` lock (`:259`) |
| 5 | Tx | `openAccount` (`W/chain.ts:260-304`) | Privy signs as player (`sign`, `W/players.ts:52-63`); relayer pays fees |
| 6 | Program | `P/instructions/account.rs:59-100` (open), `:151-172` (deposit) | `!deposits_paused`; `amount > onboarding_fee`; `max_win` bounds; `free >= max_win`; `amount >= min_deposit` (deposit only); `player_token` authority = player |
| 7 | ER credit | `sync_ledger` (`P/state.rs:352-356`) | `deposited - credited` once; clone freshness `[lead]` |

Card on-ramp: `addFunds` to the api's `solanaAddress` (`DepositPanel.tsx:106-138`): a poisoned DB row redirects it (X5).

### 4.3 Withdraw: web -> api -> relay -> ER -> commit -> Magic Action -> Solana

| # | Step | Code | Checks |
|---|---|---|---|
| 1 | `POST /v1/account/withdraw` | `A/routes/web.ts:110-117` | `webAuth`, `money`, consent. No geo, guard, lock or api cap (exit never blocked); no 2FA |
| 2 | Relay | `W/app.ts:91-101` | Key + consent; one-in-flight; no relay cap |
| 3 | Tx | `W/chain.ts:612-626` | `player_token` = derived ATA, **existence not checked** (`:621`) |
| 4 | ER `withdraw` | `P/instructions/withdraw.rs:50` (struct `:27-44`) | `sync_ledger`; `0 < amount <= balance`; `>= min_withdrawal` unless emptying; commit + `PayWithdrawals`. Token accounts unchecked in the ER (`:38-44`); allowed mid-round and with bets paused |
| 5 | `pay_withdrawals` | `P/instructions/withdraw.rs:99-148` | Escrow gate (`:115-125`); `player_token` authority = `ledger.player` (`:108`) |
| 6 | `pay_due` | `P/withdrawals.rs:120-182` | `checked_due` (`:13-25`); `due = withdrawn - withdrawn_paid`; held unless unpaused, `<= max_withdrawal`, block caps (`:68`); `vault_token >= due` **reverts** (`:157`); `reserved -= due` |
| 7 | `release_withdrawals` | `P/instructions/withdraw.rs:169` | Admin; no pause/caps; `checked_due` |

`Window::rolled` (`P/withdrawals.rs:35-38`) starts a block at `now` on the first payment after expiry: block start follows the player; held amounts pay together once they fit.

### 4.4 Checkpoint and expiry (sweeper)

- Every 30 s (`W/main.ts:59-72`, `W/sweeper.ts:29-72`), players with a `submitted` open intent (`:39-42`): `expireRound` past timeout; `checkpoint` (`W/chain.ts:443`) when Idle and loss >= `CHECKPOINT_MIN_LOSS`.
- ER `checkpoint` (`P/instructions/withdraw.rs:201`): `forfeited += loss`, commit + `ApplyCheckpoint`. `apply_checkpoint` (`:265`): escrow gate; `checked_forfeit` (`P/withdrawals.rs:187`) lacks `claim.credited <= deposited`; `reserved -= released` (`:278`).
- No leader election: two relays double-sweep (fees only).

### 4.5 Prize payout: admin CLI -> relay -> `pay_promo`

| # | Step | Code | Checks |
|---|---|---|---|
| 1 | Open | `A/competitions/store.ts:208-248` | Budget `FOR UPDATE`; seed hash published, `drop_seed` plaintext (`A/db.ts:180`) |
| 2 | Close | `A/competitions/store.ts:271-315` | App clock (`:282`); `indexed_through >= ends_at` unless `--force`; standings from `rounds`; id = `uuidv5(PRIZE_NAMESPACE, "<compId>:<kind>:<rank>")` (`A/competitions/uuid.ts:23-26`, all public) |
| 3 | Approve | `A/competitions/payouts.ts:64-72` | Human; `--competition` bulk |
| 4 | Pay | `payPrizes` (`A/competitions/payouts.ts:129-157`), `relay.payPromo` (`:95`) | Lease (`:26,82-86`); `INTENT_CONFLICT` -> `getPromo` (`:105`) filtered on `promo_payout` (`W/intents.ts:150`); no pool recheck |
| 5 | Relay | `W/app.ts:110-119` | Key only; `intentId: payoutId` (`:115`) **shares the player namespace**; `checkPromoLimits` (`W/intents.ts:269-281`) |
| 6 | `pay_promo` | `P/instructions/promo.rs:151-215` | `has_one = relayer`; `PromoPayout` `init`; `player_token` only `token::mint` (`:163`); caps; `!paused` |

### 4.6 Mod login (device code)

`/tilt login` -> `POST /v1/auth/device` (anon, `A/routes/auth.ts:13`, 10/min/IP) -> mod opens `trustedVerifyUrl(verifyUrl)` (`MOD/hooks/register.tsx:319,352`): https on the **exact** api host or its **exact** parent when the parent has a dot (`MOD/hooks/api.ts:65-66`), never siblings -> player types the code on `/connect` -> `POST /v1/auth/device/approve` (Privy, geo, 5 tries/10 min in-memory) -> poll `/v1/auth/device/token` (`FOR UPDATE`, `A/auth/device.ts:63`) -> 30-day token in `$.store`. `userCode` unconstrained (`isDeviceStart`, `MOD/hooks/guards.ts:446-458`) and echoed by `/tilt login` `[lead]`.

### 4.7 Operator paths (read only, never run)

- Pause/resume: `setPauses` (`chain/scripts/admin.ts:74-86`) rewrites the whole `Config`, which must pass `Config::validate` (`P/state.rs:54`); a stored invalid config blocks pausing `[lead]`.
- `withdraw-house`/`withdraw-promo` (`admin.ts:130,133`): to `vault.treasury`. `set-relayer`/`set-admin`: `set_roles` one step (`2026-10-13:L2`). `release <player>`: `checked_due` only. All leave only a Solana tx as trail.
- Prize ops: `pnpm --filter @tilt/api admin` (`A/admin.ts`), DB creds (+ relay key), `ADMIN_ACTOR` self-declared (`:136`), mutable `audit_log`.
- `admin.ts:46` defaults `BASE_RPC` to devnet: a mainnet operator who forgets it acts on devnet.

---

## 5. Attack trees per asset

`OR` = any branch, `AND` = all needed. Leaf = barrier + tag. "Impact if true" names a category; the level comes from `severity.md`.

### 5.1 A1 Vault USDC: "leave with more than you brought"

- OR **Forge or inflate a claim**
  - Commit `withdrawn` above allowance. Barrier `checked_due` (`P/withdrawals.rs:13-25`). `[check]` proptest.
  - Arbitrary bytes at `["account", player]` on Solana (undelegation buffer, close + recreate). `read_claim` has no owner check (`:84`). `[lead]`
  - Replay a commit/action: `withdrawn_paid` high-water mark. `[check]`
  - Inflate `max_win`: `raise_win_cap` (`P/state.rs:124`) has no lifetime ceiling; relay raises on shortfall (`W/chain.ts:323`). Paid only if won. `[lead]`
- OR **Out-of-band Magic Actions** `[lead]` (off-repo, sec-chain-rollup): the gate (`P/instructions/withdraw.rs:115-125`) assumes only the delegation program signs `ephemeral_balance_pda_from_payer(relayer, 255)`, for actions in an ER tx the relayer signed. Verify a foreign program or unsigned scheduling path cannot name the relayer as `escrow_authority` with `destination_program = tilt` (timing games, escrow drain).
- OR **Player makes the withdraw action fail** `[lead]` (sec-chain-rollup): close/empty own ATA (or Circle freeze) between ER `withdraw` and `pay_withdrawals`; `token::authority = ledger.player` (`:108`); relay never checks the ATA (`W/chain.ts:621`); `VaultTooSmall` reverts (`P/withdrawals.rs:157`). Does the failure revert the commit and leave Solana's `PlayerAccount` stale while the ER moved on? Exploitable divergence (re-withdraw, checkpoint order)? PoC: local stack, close the ATA in between.
- OR **Drain through caps** `[lead]` (sec-chain-economics): align the block start (`Window::rolled`, `P/withdrawals.rs:35-38`), let amounts be held, trigger one action right after rollover. Bound: `max_withdrawal`, `player_daily_cap` x sybils, global `daily_cap` on the house part (`house_part`, `:51`).
- OR **Win more than the rules allow**
  - RTP > 100% for some choice (keno, roulette hedging, limbo target, blackjack split/double). `[lead]` per-choice EV sweep.
  - Payout above `stake + max_gain` reserved at start in multi-step games (`P/state.rs:361-424`, `take_split` `:466`). `[check]`
  - Double settle (second callback, other kind, cash-out vs pending draw): `pending_draw` (`P/instructions/play.rs:307`). `[check]`
- OR **Bias the randomness** (sec-chain-rng)
  - Hidden state readable before the draw (accounts, logs). Lazy draws. `[lead]` incl. Hilo/Mines/Tower while the player waits.
  - `Rng::from_vrf` XOR-folds 256 bits into a 64-bit splitmix seed (`P/rng.rs:9-16`). `[lead]` modulo bias, Fisher-Yates bounds, correlation between draws.
  - `expire_round` re-roll (`P/instructions/play.rs:279`, timeout may be 1). `[known]` house side. **X1** `[lead]` player side: reachable callback panic (`expect`, `unreachable!`, index at `MAX_CARDS`), compute, or callback accounts locked/invalidated between request and fulfil -> answer visible in the failed tx -> sweeper expires.
  - Spoofed callback: identity signer. `[check]` test with any other key. Third-party VRF request with `callback_program_id = tilt`. `[lead]` off-repo.
  - Admin `vrf_queue` (pinned only to config, `:43`) or `validator` at attacker infra: outcomes chosen outright (5.7). Validator change applies to new delegations only (`P/instructions/account.rs:122`, `hilo.rs:61`): split-brain `[lead]`.
- OR **Double-credit a deposit**: stale/forked `Ledger` clone in `sync_ledger` (`P/state.rs:352-356`). `[lead]`
- OR **Account substitution** (sec-chain-accounts): fake mint, `vault_token`, `promo_token`, foreign `ledger`; `has_one`, `token::mint`, seeds. `[check]` LiteSVM (none for `account.rs`, `withdraw.rs`, `admin.rs`, `promo.rs`).
- OR **Under-reserve**: `vault_token >= reserved == sum(deposited - forfeited - withdrawn_paid + max_win)`; leaks: `checked_forfeit` misses `credited`, `2026-10-13:L5`. `[check]` multi-player proptest.

### 5.2 A2 Another player's balance

- OR **Web session takeover** (XSS, extension, T9, T15): silent consent (`useTiltAuth.ts:21`) -> withdraw -> transfer out. CSP nonce + `strict-dynamic`; `style-src 'unsafe-inline'` (`WEB/proxy.ts:34`); prefetch gets no CSP (`:55`). `[lead]`
- OR **Mod token theft** (T13, device-code phishing, at rest) -> wager their balance (no counter-position, no direct theft). `[lead]`
- OR **T6** plays any account without consent (`W/consent.ts:33`); runbook (`docs/runbook.md:39`) omits it. `[lead]`
- OR **Redirect funds** (X5): remap `players.address` (never refreshed; upsert `DO NOTHING` `W/executor.ts:19`) or `users.solana_address` (`A/users.ts:11`). `[lead]`
- OR **Freeze**: callback panic keeps `AwaitingDraw`; `PLAYER_BUSY` while RPC says `in_flight` (`W/intents.ts:177`). `[lead]`
- OR **IDOR**: scoped by `user_id` (`A/intents.ts:77-85`, `A/auth/sessions.ts`). `[check]`

### 5.3 A3 Reserved bankroll: "lock the house out"

- AND sybils + one near-`max_round_gain` move each -> auto raise -> `reserved` never lowered (checkpoints release losses, not cap) -> `free -> 0`: opens, raises, `withdraw_house` fail. Cost: fee + edge x stake. `[lead]` quantify.
- OR T16 fake `Win cap short by <huge>`. `[lead]` OR T6b raise loop. `[known]`

### 5.4 A4 Promo / prize pool

- OR **Unearned prize**: T8 approved row paid as stored (`A/competitions/payouts.ts:129-157`) `[lead]`; T6 `POST /payouts/promo` / T6b `pay_promo` to any account `[known]` cap-bounded; phantom indexed rounds (TL6, X4) `[lead]`; sybil leaderboard + drop farming (`--min-stake` 0, one ticket per round) `[lead]` EV vs loss; insider reads `drop_seed` `[lead]`.
- OR **Freeze prizes** (TL1, X6). `[lead]` OR **via player wallets** (X2). `[lead]` OR **admin** (TL8, 5.7).

### 5.5 A5 Relayer SOL and escrow

- OR **Rent farming**: boards opened before simulation (`W/chain.ts:314,394-410`); `PromoPayout` never closed (`2026-10-13:I6`); ATA rent per promo; fee in USDC, rent in SOL. `[lead]` SOL per sybil.
- OR **Commit/action spam** (withdraw/checkpoint each = commit + action; emptying bypasses `min_withdrawal`), bounded by `money` 6/min and one-in-flight. `[lead]` x sybils. OR out-of-band actions (5.1). `[lead]`
- OR **Escrow empty**: actions fail, debits stand (recover by `release`), `LOW_ESCROW` logs only (`W/monitor.ts:51`). `[known]`

### 5.6 A6 Player Privy wallets

- AND T7 AND an all-Tilt tx passes the policy (`apps/wallet/scripts/privy-setup.ts:54-64`) AND a Tilt instruction moves the signer's USDC:
  - `fund_vault` (`P/instructions/admin.rs:78-106`) / `fund_promo` (`P/instructions/promo.rs:117-147`): any `funder: Signer`, `source` authority = funder. Impact if true: irreversible theft from players (house/pool gain); attacker profit via X2.
  - `deposit`: funds stay in the player's `Ledger`, withdrawable. Impact: consent and relay-cap bypass only.
  - Evidence: `apps/wallet/test/privy.live.ts:101-113` expects Privy to refuse a raw SPL transfer, a Tilt `deposit` + transfer mix, and a policy update with the relay key. The refused mix supports per-instruction evaluation, so an all-Tilt `fund_*` tx is the expected pass: `[lead]` likely; verify on a throwaway Privy dev app only, never run `privy.live.ts`. Fix direction (Armand): restrict `fund_*` funders on-chain and/or instruction-level policy conditions.
- AND **policy never attached** (TL3): `policyIds` from the api (`DepositPanel.tsx:101-102`), `wallet.delegated` short-circuit (`:100`), relay never checks (`W/players.ts`). `[lead]`
- OR T7b edits the policy (key "to be moved offline", `docs/runbook.md:50`). `[lead]` OR web session theft / T15. `[lead]`
- OR Privy dashboard: allowed origins, dev app shared with prod, wallet export, login-method linking/merging (`WEB/components/privy/PrivyProviders.tsx`). `[lead]` ask the owner.

### 5.7 A7 Admin / upgrade authority

- OR **Steal the key**: admin = upgrade key on a laptop (`~/.config/solana/id.json` default); `local-stack.sh` mounts `$HOME` rw with `seccomp=unconfined` (`chain/scripts/local-stack.sh:24-35`); T9. `[lead]`
- OR **Blind signing**: `--squads` prints base58 to sign; no timelock or simulation. `[lead]` once Squads is live.
- OR **Abuse powers without upgrade** (T12, TL8):
  - Promo pool in one tx: `set_promo` with `daily_cap = max_payout = pool` (`P/instructions/promo.rs:24-30,110`) + `set_roles` relayer = attacker (`P/instructions/admin.rs:66`) + `pay_promo` to any account (`promo.rs:163`). `[lead]` LiteSVM.
  - Free bankroll: `set_config` with huge round/player caps and `max_withdrawal` + relayer = attacker + `raise_win_cap` loop on an attacker ledger (`P/state.rs:124`) + `vrf_queue`/`validator` at attacker infra (or timeout 1 re-rolls) -> win every round -> withdraw or `release_withdrawals` (still `checked_due`). `[lead]`
  - `withdraw_house`/`withdraw_promo` pay only `vault.treasury` (fixed at `initialize`, `P/instructions/admin.rs:43`, no setter): a risk only if the treasury owner is also compromised (`?` deployed owner; e2e uses the admin's ATA).
  - Pausing needs the same key (no guardian). `[known]`
- OR **e2e on a shared vault**: `e2e.ts --shared-vault` rewrites its config; guard = localhost regex (`:691`). `[lead]` ops.

### 5.8 A8 + A13 Mod token and players' machines

- OR **Token exfiltration** (X3): any https `apiUrl` (`MOD/hooks/api.ts:31-37`), token not origin-bound; attacker owns base and parent, so its `verifyUrl` passes. `[lead]`
- OR **verifyUrl on the real parent**: exact host or exact parent only (`:65-66`); `vercel.app`-style parents are not registrable. Real risk: dangling apex DNS or T15. `[lead]`
- OR **Prompt injection into the agent**: `/tilt login` text from api strings (`userCode`, 4xx `error.message`); sponsor strings after `cleanText`. `[lead]`
- OR **Resource exhaustion**: no response size/array caps. `[lead]` OR **malicious release** (T10). `[lead]`
- Holds: no `fs`/`env`/`tool`/`prompt` capability; play-only token; logout on 401. `[check]`

### 5.9 A10 + A11 + A15 Off-chain state, secrets, PII

- DB write (T8): prize insert, wallet remap, deleted relay intents reset rolling caps (`W/intents.ts:247-281`), `audit_log` edits (no trigger/REVOKE; app creds run DDL migrations). `[lead]`
- DB read: `drop_seed`, emails + user->wallet map (A15); `NOTION_TOKEN` = waitlist PII. `[lead]`
- 500 paths (`W/consent.ts`, `A/app.ts`) never echo tokens or `pg` values. `[check]`
- Relay `HOST` `127.0.0.1` (`W/config.ts:39`) vs api `0.0.0.0`; no deploy manifests (`?`). `relay.env(.admin)` in the repo would not be git-ignored. `[lead]`

### 5.10 A12 Repo, CI, deploy, supply chain

- Push to `main` without review (plan blocks protection). `[lead]` confirmed config.
- Remote `prod` has commits not on `main`, no CI: which branch does Vercel deploy, was its diff reviewed? `[lead]`
- Mutable refs: `actions/*@v4`, `dtolnay/rust-toolchain@master`, `ghcr.io/gitleaks/gitleaks:v8.24.0` (`.github/workflows/quality.yml:34`), `postgres:17` (`api.yml`, `chain.yml`, `wallet.yml`); `curl | sh` Agave + `cargo install --git --tag` (`chain.yml`); `cache-bin: true`; `npm install -g @anthropic-ai/claude-code` (`mod.yml`). 0 CI secrets today. `[lead]`
- No `--locked`, `cargo audit`/`deny`, or `minimumReleaseAge`; lint skips `apps/wallet`, `chain/` TS, `packages/contract`. `[lead]`

### 5.11 A14 Fairness, reputation, regulator

- House-side bias (relayer seed + timing, T11/T11b + expire) invisible without expire events. `[known]` Impression fraud (`A/routes/mod.ts:79-90`). `[lead]` Circle freeze: no technical barrier. `[lead]`

---

## 6. Spec §10 promises vs enforcement

Status: **E** enforced; **P** partial; **N** absent/convention; **?** not verifiable from the repo (ask); **E/P** = enforced on the main path, partial elsewhere; **P/?**, **N/?** = partial/absent in repo, rest unverifiable; **n/a** = feature absent. A P/N row on a money risk is a finding only with a concrete attack. Report a pure spec gap with `layer` = the layer that should enforce it, `invariant` = the spec line (e.g. "spec §10.2 withdraw 2FA"), severity per `severity.md` §2 Low/Info.

| Spec | Promise | St. | Where / what is missing |
|---|---|---|---|
| 10.1 | Program authoritative; clients send intents | E | Relay builds accounts from wallet + vault; program re-checks. Exception: prize winners from the index |
| 10.1 | Fail closed | P | Loss limit fails open on indexer lag (`A/limits.ts:154-178`); `GEO_ALLOW_UNKNOWN`; pausing depends on `Config::validate` |
| 10.1 | Least privilege | N | App DB users run DDL migrations; admin = upgrade key; client attaches the policy; api holds `PRIVY_APP_SECRET` |
| 10.1 | Defence in depth: "an application rule **and** a DB constraint or a global limit" per money risk | P | Withdrawals, promo, deposits: E (rule + on-chain or relay global limit). Player wallets: Privy policy only (N). Prizes: review only, no `sum(prizes) <= pool` constraint (N) |
| 10.1 | Idempotent + immutable audit log | P | Idempotent (E: intent PKs, `payout_id` PDA, `withdrawn_paid`). Relay `intents` and api `audit_log` mutable; chain admin untraced |
| 10.2 | Capped hot wallet; Squads 2-of-3 hardware | N | Single admin key; runbook plans 2-of-2 (`docs/runbook.md:45-50`) |
| 10.2 | No keys in code/.env/logs; signing policies | P | gitleaks + ignored `.env*` (E); raw `RELAYER_SECRET_KEY` in env; `relay.env` not ignored; policy permits player-signed `fund_*` (T7) |
| 10.2 | Fake deposit: finality, exact mint, idempotent | P | Mint pinned, credit from `Ledger` (E); ER clone commitment `?` |
| 10.2 | Withdraw web-only, fresh re-auth + 2FA, review above threshold | P | Web-only, on-chain hold + `release` (E); silent identity token, no 2FA (N) |
| 10.2 | Delay + reduced cap on new address **and after any account change** | N | Destination fixed to `ledger.player`, but Privy login-method linking/merging or email change triggers nothing |
| 10.2 | Per-user, daily, global caps | E | `pay_due` (`P/withdrawals.rs:68`); player-aligned blocks, up to 2x at a boundary |
| 10.2 | Auto circuit breaker | N | `W/monitor.ts` logs only; promo pool unmonitored |
| 10.2 | No double spend; settle once | E | `request_id` (`P/instructions/play.rs:97,307`), `checked_due`, `overflow-checks` (`chain/Cargo.toml:6`); no proptest |
| 10.2 | No payment decided on the index | **N** | Prizes from `confirmed` `rounds` (`A/competitions/store.ts:128-148,271-315`; `A/db.ts:1-3` admits it) |
| 10.2 | Audit, fuzzing, multisig upgrade, verifiable build, in-program limits | P | In-program limits (E); rest N |
| 10.2 | Separate kill switches, either founder | P | Flags (`P/state.rs:46-49`, `promo.paused`) (E); one key; double/split ignore `bets_paused` (`2026-10-13:I2`) |
| 10.3 | State machine, settle once | E | See 10.2 |
| 10.3 | One intent in flight; `intentId` end to end | E/P | `W/db.ts:48-49` (E); namespace shared with promo (TL1) |
| 10.3 | Callback = oracle + current request; no favourable re-roll | P | Callback E; expire re-roll open (`P/state.rs:72`); `vrf_queue`/`validator` admin-settable instantly (5.7) |
| 10.3 | RTP tested, 380 Rust vectors | E | `P/games/*`; `apps/api/test/games.test.ts` |
| 10.3 | Free option (hand left open) gives no info | P | `PlayerTurn` never expires (`P/instructions/play.rs:302`), lazy draws (E); `[check]` no pending state leaks |
| 10.3 | Competitions: min stake, tickets/h, one drop, review, deterministic id | P | `--min-stake` default 0 (`A/admin.ts:101`); id predictable (TL1) |
| 10.4 | Rate limits per user/session/IP/global, everywhere; min delay between hands | P | api in-memory, `/health` exempt; relay none; waitlist leftmost XFF; no min delay |
| 10.4 | One account per person, KYC | N | Onboarding fee only |
| 10.4 | Bot detection, freeze winnings | N | — |
| 10.4 | No withdrawable bonus; free tokens never convertible | P/? | None in code; promo/drop prizes are withdrawable USDC with no wagering |
| 10.5 | Short refreshable play-only revocable mod session | P | Play-only + revocable (E); 30-day token, no rotation |
| 10.5 | api <-> wallet private, strong auth | P/? | Bearer + constant-time (E); no TLS; topology `?` |
| 10.5 | Signed webhooks | n/a | None |
| 10.5 | Schemas everywhere; parameterized SQL; integer amounts | E/P | zod api/relay/contract (E); web does not validate api JSON (`WEB/lib/api.ts:139`) |
| 10.5 | Host secret manager, rotation, CI scan | P/? | gitleaks, rotation runbook (E); host `?` |
| 10.6 | Mod reads no prompts/code/tools; **only turn start/end events**; only `open <url>`; no files | P | Single `$.process.run` (`MOD/hooks/register.tsx:319`) (E); also registers `session.start`, `command.run`, `config.set`, `ui.*` (`:1520-1636`): check none exposes prompt content |
| 10.6 | Mod token play-only; `http` only `127.0.0.1` | P | Also `localhost`/`[::1]` (`MOD/hooks/api.ts:28,37`); any https host (T13) |
| 10.6 | Releases from CI with a Git tag | N | Marketplace tracks `./apps/mod` |
| 10.6 | Lockfile, pins, Dependabot, `pnpm audit`, no postinstall | P | Frozen lockfile, `pnpm audit`, `allowBuilds` (E); caret ranges, no Dependabot, no `cargo audit`, mutable tags |
| 10.7 | Immutable audit log | N | See 10.1 |
| 10.7 | Monitoring: reconciliation, spikes, RTP drift, errors, rate limits | P | `W/monitor.ts:28-57` partial; no delivery channel |
| 10.7 | Encrypted, restore-tested backups | ? | — |
| 10.7 | Admin 2FA, named accounts, traced money actions | N | `ADMIN_ACTOR` self-declared |
| 10.7 | Runbook incl. **refunds** | P | `docs/runbook.md` lacks T6 gambling, T7 `fund_*`, USDC freeze, refund procedure |
| 10.8 | `Sécurité :` line, cross review, M3 review, external audit | N/? | Convention; no CODEOWNERS |
| 10.8 | Bug bounty after launch | ? | No `SECURITY.md` yet |

---

## 7. Cross-layer chains (canonical ids; all `[lead]`)

No single-layer hunter sees these. Red-team and insider agents: complete each or name the blocking `file:line`. Step-by-step detail for X1, X2, X3, X5, X7 is in `attack-playbook.md` §3; this table is the id list of record.

| ID | Chain | Blocking candidates to check |
|---|---|---|
| X1 | Forced callback failure -> visible randomness -> sweeper `expire_*` -> free re-roll (5.1) | Reachable callback panic/lock; does the failed tx reveal the value; is expire refused after a delivered-but-failed answer |
| X2 | Policy not attached or `programId`-only -> T7 creds -> player-signed `fund_vault`/`fund_promo` -> promo paid out by T6/T6b (5.6) | Privy per-instruction evaluation; who may be `funder`; relay check of the signer's policy |
| X3 | Hostile `apiUrl` -> mod token + attacker `verifyUrl` -> Privy phishing -> web session -> withdraw -> transfer out (5.8) | Token origin binding; Privy allowed origins |
| X4 | Sybil drop/leaderboard farming or phantom indexed rounds (T16, rollback, truncation) -> close passes `indexed_through` -> approval -> `payPrizes` (5.4) | Index commitment, truncation, review checklist, `min_stake` |
| X5 | DB write remaps `players`/`users` wallet -> on-ramp `addFunds` + promo payouts to attacker (5.2) | Re-check against Privy before money use; set-once semantics |
| X6 | Public prize ids -> `/v1/play` squats `intentId` -> relay `INTENT_CONFLICT` -> prize stuck (5.4, TL1) | Namespace separation in relay; v4-only ids for play |
| X7 | Compromised relayer (T6b) or validator (T11) + selective `expire` on attacker accounts -> wins only -> withdraw within per-player caps x sybils | Min timeout, expire events, caps vs sybil count |
| X8 | Sybil `raise_win_cap` lock (5.3) -> house cannot withdraw, new players refused -> combine with escrow drain (5.5) or forced action failures (5.1) to stall exits -> ransom | Lifetime cap per ledger, cap release path, auto-pause, paging |

---

## 8. Known items: re-verify, do not re-report as new

From `docs/audits/2026-10-13-chain-relay.md` and `docs/runbook.md`:
- Relayer is the only ER signer; player consent is not cryptographic on-chain; no escape hatch if ER/relay is down.
- Validator trust bounded per player by `deposited - forfeited + max_win`.
- `expire_round` re-roll when the house/sequencer sees the oracle answer first; `round_timeout_secs = 1` accepted.
- Single admin = upgrade key until Squads; `2026-10-13:L2` one-step `set_roles`.
- Fixed 24 h blocks -> up to 2x caps around a boundary (withdrawals and promo). New angle worth reporting: player-aligned block start + held amounts (5.1).
- `2026-10-13:L1` relayer rotation lag in the ER; `2026-10-13:L5` global cap undercount (`house_part` uses `ledger.forfeited`).
- `2026-10-13:I2` double/split ignore `bets_paused` (hand stake up to 2x `max_bet`); `2026-10-13:I4` no `min_deposit` on first open; `2026-10-13:I6` `PromoPayout` never closed, `treasury` immutable.
- `2026-10-13:F5` rollup expiry semantics, `2026-10-13:F9` Privy wallet cache never refreshed, `2026-10-13:F11` promo pool unmonitored and `/health` unauthenticated: still open.

Report one only if the code changed, the impact is larger than documented, or you found a new way to reach it.
