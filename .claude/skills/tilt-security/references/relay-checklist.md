# Relay checklist: `apps/wallet` + `packages/contract`

Zone: Armand (`apps/wallet`), shared (`packages/contract`). Report with PoC; never edit.
Line numbers were verified at `d559a31` (2026-10-19). Code moves: **re-read every pointer at the target commit** before quoting it. Items tagged "lead (verify)" are hypotheses, not facts. Statuses below are *claimed*, not proven: re-verify before relying on them. Each item carries its `INV-xx` from `invariants.md` (use it in the finding's `invariant` field); "new: propose INV" means none exists yet.

**Highest-yield first** (tight budget: do these, then walk the rest):
1. Privy policy scope + client-controlled policy attachment (§3, INV-41/54).
2. Prize-id squat via shared intent-id namespace (§6, INV-48).
3. api/relay `NOT_RECORDED` refusal contract (§2, INV-34).
4. False `failed` → cap bypass / duplicate deposit on retry (§6, §9, INV-36/38).
5. Win-cap reservation never released for non-losing players (§7, INV-02/11/42).

## 0. Files and sizes (read all of `src/` before claiming anything)

| File | Lines | What to look at |
|---|---|---|
| `apps/wallet/src/app.ts` | ~134 | routes, auth middleware, body limit, refusal → HTTP mapping |
| `apps/wallet/src/consent.ts` | ~49 | `PrivyConsentVerifier`, `requireConsent`, `NEEDS_CONSENT`, `CONSENT_MAX_AGE_SECS` |
| `apps/wallet/src/intents.ts` | ~300 | `submit`, `claim`, `replay`, `canonical`, caps, `record`, `settle`, `reconcile`, `outcomeOf`, `SAFE_MESSAGES` |
| `apps/wallet/src/executor.ts` | ~33 | userId → wallet → dispatch; `players` upsert |
| `apps/wallet/src/players.ts` | ~64 | Privy wallet lookup + DB cache; `sign()` via Privy authorization key |
| `apps/wallet/src/chain.ts` | ~682 | every tx builder, `play`, `raiseWinCap`, `ensureGameAccount`, `payPromo`, `simulateRecordSend`, `sendBase`, `sendRollup`, `transactionStatus` |
| `apps/wallet/src/db.ts` | ~54 | schema: `players` (`address UNIQUE`), `intents`, partial unique index |
| `apps/wallet/src/sweeper.ts` | ~72 | reconcile → expire stuck draws → checkpoint |
| `apps/wallet/src/monitor.ts` | ~86 | alerts (`INSOLVENT`, `LOW_*`, `STUCK_INTENTS`, `PAUSED`, `MONITOR_FAILED`) |
| `apps/wallet/src/main.ts` | ~97 | boot check `vault.relayer`, Privy client, timers, alert output, shutdown |
| `apps/wallet/src/config.ts` | ~88 | env schema, defaults for every cap |
| `apps/wallet/scripts/privy-setup.ts` | ~70 | key quorums + the Privy policy |
| `packages/contract/src/relay.ts` | — | zod: `Amount`, `Action` (all variants), `PrivyUserId`, `IntentRequest`, `PromoPayoutRequest`, `ErrorCode` |
| `packages/contract/src/program.ts` | — | `PROGRAM_ID`, PDA helpers (must equal IDL seeds) |
| `packages/contract/src/idl/` | — | synced by `chain/scripts/sync-idl.sh`, CI diff `.github/workflows/chain.yml:85-88` |
| api callers | — | `apps/api/src/relay.ts` (`HttpRelay`, `NOT_RECORDED` `:27`, `refusal()` `:53-66`), `apps/api/src/intents.ts` (`forward` `:153-168`, `status` `:77-88`), `apps/api/src/wallets.ts` (address cache), `apps/api/src/routes/web.ts:75` (signer + policy ids), `apps/api/src/competitions/payouts.ts:105` (`getPromo`) |
| web caller | — | `apps/web/app/(site)/(wallet)/account/DepositPanel.tsx:93-103` (`addSigners`) |

Program accounts the relay drives (cross-check only): `chain/programs/tilt/src/instructions/{account,withdraw,promo,admin}.rs`, `state.rs:124-145` (`raise_win_cap`).

## 1. Trust model in one screen

```
browser ──Privy access + identity token──► apps/api ──Bearer RELAY_API_KEY (private net)──► apps/wallet
apps/wallet ──RELAYER_SECRET_KEY (fee payer, vault.relayer)──► program (Solana + rollup)
apps/wallet ──PRIVY_AUTHORIZATION_KEY (key quorum on player wallets, policy-scoped)──► Privy TEE signs player side
```

- The relay authenticates **the api, not the player**. `userId` comes from the api and is trusted, except consent for `open_account | deposit | withdraw` (`consent.ts:33`).
- No account address ever comes from request input: all are PDAs from `@tilt/contract`, `wallet.address` (Privy/DB), on-chain `vault.mint` / `vault.treasury`, config `VRF_QUEUE`. Input reaches txs only as **instruction args** (amounts, enums, tiles, picks, payoutId bytes). Confirm this still holds (§7, INV-39).
- `client_seed` is relay-generated `randomBytes(32)` (`chain.ts:170`), never from input.
- Trusted without re-check: the api, the `players` DB cache (`players.ts:30-35`), Privy API answers, Solana + rollup RPC answers (status, heights, simulation logs, vault fields).
- All relay secrets live in one process env: `RELAYER_SECRET_KEY` (`main.ts:29`) next to `PRIVY_APP_SECRET` + `PRIVY_AUTHORIZATION_KEY` (`main.ts:36-37`). A full env leak combines every row of §10.

Assets the relay can touch:

| Asset | Where | Relay power over it |
|---|---|---|
| Vault USDC (bankroll + deposits) | `vault_token` PDA | none directly; reserves bankroll via `open_account` maxWin and `raise_win_cap`; triggers Magic Action withdraw payments |
| Promo pool | `promo_token` PDA | `pay_promo` (relayer signer, on-chain pool caps) to any USDC token account (`promo.rs:163-164`: only `token::mint`) |
| Player wallet USDC | Privy embedded wallet ATA | signs player side through Privy key quorum, scoped only by policy |
| Player in-game balance | `PlayerAccount` in rollup | all moves signed by relayer (`payer = vault.relayer`) |
| Relayer SOL | `RELAYER_SECRET_KEY` | pays every fee and rent |
| Relayer MagicBlock escrow | `escrowPdaFromEscrowAuthority(relayer)` | pays Magic Actions (withdraw payments, checkpoint applies) |

## 2. api → relay authentication and refusal contract (`app.ts`, `config.ts`, `apps/api/src/relay.ts`)

At `d559a31` (re-verify): `bodyLimit` 8 KiB on `*` (`app.ts:51,69`); `GET /health` registered **before** auth (`app.ts:71-74`); bearer auth = SHA-256 of token vs SHA-256 of each key, `timingSafeEqual`, all keys compared (`app.ts:35-38,76-79`); keys ≥ 32 chars, comma list for rotation (`config.ts:43`); `HOST` default `127.0.0.1` (`config.ts:39`). No TLS, no rate limit, no IP allow-list in-process.

- [ ] [route, INV-40] Every route except `/health` sits after the auth middleware. A new route registered above `app.use("*", auth)` is unauthenticated: diff route order.
- [ ] [auth, INV-40] `authorized()` handles missing header, `Bearer` with empty token, lowercase `bearer`, extra spaces: none may match a key. Empty-string key impossible (`min(32)` after `trim`).
- [ ] [auth, INV-40] Keys list: duplicates, whitespace-only after trim, a key that is a prefix of another: harmless with hashing; confirm.
- [ ] [health, INV-40] `/health` is unauthenticated by design (prior F11, open). Confirm it returns only `{ok}` and a 503 with no error text (`app.ts:72-73`).
- [ ] [ssrf, INV-40] Deployment: relay bound to loopback or private net only; nothing in api lets a user choose the relay URL or path (SSRF into the relay = full api-key power). `rg -n "RELAY_URL" apps/api/src` → `main.ts:24`, `admin.ts:68` only. `HttpRelay` builds paths with `encodeURIComponent` (`apps/api/src/relay.ts:77,85,93`).
- [ ] [input, INV-43] Path params: `PrivyUserId` regex `^did:privy:[a-z0-9]{20,40}$` (`relay.ts:151`), UUID ids lowercased (`app.ts:48`). Check no raw param reaches SQL or Privy URLs elsewhere.
- [ ] [errors, INV-53] `onError` returns generic 500 and logs `e.message` only (`app.ts:128-131`): check no message can carry a token or key.
- [ ] [ratelimit, INV-50] No rate limit at the relay. `GET /users/:id` with unknown ids costs one Privy `users()._get` each (`players.ts:37`) → Privy quota exhaustion = deposits/consent DoS. Lead (verify): severity depends on api-side limits in front of `walletOf` (`apps/api/src/wallets.ts:15`).
- [ ] [errors, INV-34] Relay HTTP mapping: `CONSENT_REQUIRED`→403, `INTENT_CONFLICT`/`PLAYER_BUSY`→409, `LIMIT_EXCEEDED`→422 (`app.ts:46,56-64`); every other `IntentError` is stored as `failed` and returned **200**; a non-`IntentError` before send becomes stored `failed NETWORK_ERROR` (`intents.ts:115-122`). Check the api treats 200 + `failed` as final and never retries a stored id expecting re-execution.

**Cross-zone refusal contract [INV-34; new: propose INV "api forgets an intent only if the relay recorded nothing"].** The api deletes its `pending` row so the same id can be resent when the call throws an `ApiError` whose code is in `NOT_RECORDED = {PLAYER_BUSY, BLOCKED, FORBIDDEN}` (`apps/api/src/relay.ts:27`) **or** `INTENT_CONFLICT` (`apps/api/src/intents.ts:163-165`). The api decides on its **translated** codes: `refusal()` maps relay 422 `LIMIT_EXCEEDED` → `BLOCKED`, 403 `CONSENT_REQUIRED` → `FORBIDDEN`, 409 passes through, anything else → `UPSTREAM_ERROR` (`apps/api/src/relay.ts:53-66`). Check:
- [ ] (a) Each api code in `NOT_RECORDED` is produced only from a relay refusal that leaves no row: `CONSENT_REQUIRED` before `claim` (`app.ts:97`), `LIMIT_EXCEEDED` inside `claim`'s rolled-back xact, `PLAYER_BUSY` from the partial index. A new relay refusal mapped to `BLOCKED`/`FORBIDDEN` after insert = double execution under one key.
- [ ] (b) No other api path inside `forward`'s `try` (`apps/api/src/intents.ts:159-167`, which includes `save()` after the relay answered) can throw `BLOCKED`/`FORBIDDEN`/`PLAYER_BUSY` after a relay POST may have recorded.
- [ ] (c) Timeouts, network errors, 4xx/5xx without a contract body and contract-mismatched 200s map to `UPSTREAM_ERROR` "retry with the same id" (`apps/api/src/relay.ts:50,128-131,136-141`) and are **never** deleted.
- [ ] (d) `INTENT_CONFLICT` means the id is **already recorded** (by this or another user/action). Deleting the api row is safe only because the same id can never execute again at the relay. Confirm the api never reuses that id for a *different* action that the relay would then replay.
No shared test covers (a)-(d): propose one per code.

## 3. Privy signer and policy (`players.ts`, `scripts/privy-setup.ts`, web/api attach) [INV-41, INV-54]

How it works: the web adds the relay key quorum as a signer on the player's embedded wallet with `policyIds` (`DepositPanel.tsx:101-102`, values from `apps/api/src/routes/web.ts:75`). The relay calls `privy.wallets().solana().signTransaction(walletId, {authorization_private_keys:[PRIVY_AUTHORIZATION_KEY]})` (`players.ts:52-57`), then copies only the signature for `wallet.address` into its own tx object (`players.ts:58-61`).

Policy (`privy-setup.ts:53-67`): one ALLOW rule, `method: signTransaction` (`:62`), condition `solana_program_instruction.programId == PROGRAM_ID` (`:64`), `owner_id` = admin quorum (`:58`, kept offline). Claimed semantics "every instruction must match an ALLOW rule; methods without a rule are denied" is **Privy docs, not verifiable in code: confirm via `privy.live` or write "cannot verify"**.

Live coverage today (`apps/wallet/test/privy.live.ts:92-113`, manual): refuses a raw SPL transfer (`:101-103`), refuses a Tilt `deposit` + transfer mix (`:104-109`), refuses `policies().update` with the relay key (`:110-113`). Nothing else.

Severity: entry with leaked Privy creds is rung **A4** (`severity.md` §3) → rate the missing second barrier one level below the money it exposes: **High, flagged "needs leaked key"**. Critical only if an A0-A2 path reaches Privy signing (candidate: client-controlled policy attachment below).

- [ ] [privy-scope, INV-41] **Policy is program-id only, not instruction-level.** With `PRIVY_APP_SECRET` + `PRIVY_AUTHORIZATION_KEY` **alone**, reachable Tilt instructions where the player is the only required signer: `deposit` (`account.rs:135-147`: `player: Signer`, `player_token` `token::authority = player`, any amount, bypasses relay caps and consent), `fund_vault` (`admin.rs:78-91`, `funder: Signer`, source `token::authority = funder`), `fund_promo` (`promo.rs:117-132`). The tx fee payer can be **any attacker key**: the policy looks at instructions, not the fee payer. Lead (verify): can every delegated wallet be swept into the vault / promo pool, and then the pool paid out by a leaked relayer key to any ATA (`promo.rs:163-164`)?
- [ ] [privy-scope, INV-41] `open_account` is **not** reachable with Privy creds alone: `OpenAccount.payer` must be `vault.relayer` and sign (`account.rs:38-40`). It is reachable with Privy creds + `RELAYER_SECRET_KEY`, which sit in the same env (`main.ts:29,36-37`): a full env leak covers it.
- [ ] [privy-scope, INV-41] Player as rent payer: under leaked creds, can a Tilt instruction whose rent payer is a free `Signer` be signed with the **player** as payer (drains wallet SOL; at Tilt today rent payers are `vault.relayer`-constrained: list every `payer`/`init` in `chain/programs/tilt/src/instructions` and confirm)?
- [ ] [privy-scope, INV-41] v0 transactions with address lookup tables: does Privy resolve ALT-loaded program ids before evaluating `programId`, or can an instruction whose program id comes from an ALT slip past? (Privy behaviour, not in code: test in `privy.live` with a v0 tx, or say cannot verify.)
- [ ] [privy-methods, INV-41] Other Privy methods with the relay quorum: `signAndSendTransaction`, `signMessage`, wallet export. Each must be refused. Is there a deny rule, or does Privy default-deny methods with no rule? Is there a deny-export rule? (Needs Privy dev-app evidence.)
- [ ] [privy-owner, INV-41] Wallet `owner_id`: who owns player wallets (user, app, quorum)? It must **not** be the relay quorum; otherwise the quorum can change signers/policies or export. Policy owner = admin quorum is set in code (`privy-setup.ts:58`); the wallet owner is not visible in code: needs Privy dev-app evidence.
- [ ] [privy-attach, INV-54] **Policy attachment is client-controlled.** `addSigners` runs in the browser; the relay never checks that the wallet's `additional_signers` entry carries `PRIVY_POLICY_ID` before signing. If the web/api omits `policyIds` (config error, XSS, tampered bundle, player's own client), the quorum gets **unrestricted** signing on that wallet. Also `if (wallet.delegated) return;` (`DepositPanel.tsx:100`) skips adding the Tilt signer when any signer exists. Lead (verify): can Privy enforce a default policy on the quorum itself? Should the relay read the wallet's signers and refuse?
- [ ] [sign, INV-39] `sign()` trusts Privy's returned tx only for the signature; a signature over a different message makes the tx invalid, not different. Confirm `tx` is not mutated between serialize and `addSignature` (same object; `partialSign(relayer)` happens after, `chain.ts:671-672`).
- [ ] [sign, INV-39] Which txs carry a player signature: only `open_account` (+ table opens) and `deposit` via `sendBase(tx, record, player)`. Grep `sendBase(` callers: any new caller passing `player` widens what the player signs.
- [ ] [wallet-pick, INV-39] Wallet selection: `find` picks the first `linked_accounts` entry with `chain_type=solana`, `connector_type=embedded` (`players.ts:41-43`). Multiple embedded Solana wallets → which one gets the quorum? Mismatch = signing failure (DoS), or deposits from a wallet the player did not expect.
- [ ] [cache, INV-39] **Cache-on-lookup**: `GET /users/:id` calls `find`, which inserts the first embedded wallet into `players` permanently for **any** Privy user, even one who never played (`players.ts:37-48`, `app.ts:85`). Combined with "never refreshed" (prior F9, `players.ts:30-35`), the first answer wins forever. See §10 DB row.
- [ ] [secrets, INV-41] `PRIVY_AUTHORIZATION_KEY` validated as P-256 PKCS8 (`config.ts:26-33`); never logged (`rg -n "authorizationKey|PRIVY_AUTHORIZATION" apps/wallet/src`).

## 4. Consent semantics (`consent.ts`, `app.ts:91-101`) [INV-37]

- Required only for `NEEDS_CONSENT = {open_account, deposit, withdraw}` (`consent.ts:33`). Game moves and promo payouts: API key alone.
- Check: Privy `verifyIdentityToken` signature, then `iat` parsed by hand from the payload (`consent.ts:25-27`), `identity.userId === userId`, `now − iat ≤ 300 s` (`consent.ts:35,46`). Verifier error → `CONSENT_REQUIRED` (fail closed) and the error message is logged (`consent.ts:42`).
- The token is stripped before `submit` (`app.ts:95`) and never stored. `requireConsent` runs **before** the replay check, so a replay of a stored money intent also needs a fresh token.

- [ ] [consent, INV-37] Token is **not single-use and not bound to intent/amount**: one token = unlimited deposits/withdrawals for 5 min by whoever holds it plus the API key. Deposits bounded by caps; withdrawals go only to the player's own ATA (`withdraw.rs:108`, `token::authority = ledger.player`). Rate the residual risk, do not call it safe.
- [ ] [consent, INV-37] Future `iat` not rejected at the relay (`consent.ts:46`); the api rejects `iat` > 30 s ahead (`apps/api/src/http.ts:136-155`). Layers disagree; low risk since `iat` is Privy-signed.
- [ ] [consent, INV-37] Freshness is not human approval: the web can mint a fresh identity token silently (`getIdentityToken()`). XSS/extension/tampered bundle = consent. Lead (verify) in web zone; relevant to withdraw step-up.
- [ ] [consent, INV-37] Access token passed as identity token: confirm the installed `@privy-io/node` identity-token parser rejects an access token (no `linked_accounts`). Test: must yield `CONSENT_REQUIRED`.
- [ ] [consent, INV-37] Token from another Privy app (wrong `aud`), `alg:none`, HS256 with the public key, expired `exp`, malformed segments: all must yield `CONSENT_REQUIRED`, never 500. No unit test of `PrivyConsentVerifier` exists today.
- [ ] [logs, INV-53] Does the logged Privy error text (`consent.ts:42`) ever echo the token? Check SDK error messages.
- [ ] [consent, INV-37] Any new money-moving action type added to `Action` must be added to `NEEDS_CONSENT`. Diff `relay.ts` `Action` variants vs the set.

## 5. Intent validation (`packages/contract/src/relay.ts`) [INV-43, INV-44]

- `Amount` (`relay.ts:7-11`): regex `^[1-9]\d{0,19}$` + `≤ u64::MAX`, guarded before `BigInt`. `Action` = all variants (`relay.ts:88-137`) + dice `superRefine` (`relay.ts:140-146`). `IntentRequest` (`relay.ts:156-165`), consent token `1..4096` chars. `PromoPayoutRequest` (`relay.ts:208-219`): `poolId ≤ 100`, `reason ≤ 200`, bookkeeping only, stored in `action` JSONB, part of `canonical` equality.
- zod objects are **non-strict (strip)**: unknown keys dropped before storage and `canonical()`. Becomes unsafe if anyone adds `.passthrough()`. The api side is `.strict()` (`apps/api/src/schemas.ts`).

- [ ] [amount, INV-43] `Amount` ⇔ canonical integer in [1, 2^64−1]: no leading zeros, sign, spaces, exponent, unicode digits. `0` refused. Value at exactly `u64::MAX` accepted and then refused on-chain cleanly (prior I1 was a panic on a huge stake).
- [ ] [bounds, INV-43] Every `Action` zod accepts is within the program's static bounds (mines 1..24, dice range, limbo bounds, flips 1..10, keno distinct ≤ 10 of 1..40, wheel segments set, tower tile, roulette chips distinct, blackjack hands). Differential test zod vs program validation; a zod-accepted value the program refuses is fine (simulation refusal), the reverse is a DoS bug only.
- [ ] [enum, INV-39] Enum mapping tables in `chain.ts` (`HILO_MOVE`, `TOWER_DIFFICULTY`, …): an action value with no mapping must throw, not send `undefined` → default enum variant.
- [ ] [promo-id, INV-48] `payoutId` → 16 bytes: `Buffer.from(payoutId.replaceAll("-",""), "hex")` (`chain.ts:426`) on the lowercased UUID. Distinct UUIDs ⇒ distinct PDAs; a mixed-case id maps to the same seed in api, relay and program.
- [ ] [idl, INV-44] IDL in `packages/contract/src/idl` matches `chain/` (CI: `.github/workflows/chain.yml:84-88`); PDA helpers in `program.ts` equal IDL seeds (`program.test.ts`).
- [ ] [new-action, INV-37/42] New `Action` variant: tx builder in `playTransaction` (`chain.ts:560+`), `STAKING_MOVES` membership (`chain.ts:49`), `GAME_ACCOUNT_OF`, consent set, api schema. A staking move missing from `STAKING_MOVES` silently skips `ensureGameAccount` and the win-cap raise (fail closed, but check).

## 6. Idempotency, locks, caps (`intents.ts`, `db.ts`) [INV-34, INV-35, INV-38, INV-48]

Pipeline (`intents.ts:156-174`): `claim` → `executor.execute` with a `record` callback → `settle`.

- `claim` (`intents.ts:207-238`): own client, `BEGIN`, `pg_advisory_xact_lock(hashtextextended(userId,0))`, look up id → replay (`intents.ts:240-245`: same `user_id` and `canonical(action)` else `INTENT_CONFLICT`); else caps, `INSERT … 'pending'`, `COMMIT`. Unique violation on `intents_one_pending_play_per_user` → `PLAYER_BUSY`; on PK (same id inserted under another user's lock) → re-read + replay.
- Partial unique index (`db.ts:48-49`): `ON intents (user_id) WHERE status = 'pending' AND action->>'type' <> 'promo_payout'` = one non-promo intent in flight per player. This is the **only** relay serialization for withdraws (api-side guard: lead (verify) in `apps/api/src/intents.ts`).
- `record` (`intents.ts:160-168`): `UPDATE … SET signature … WHERE status='pending'`; 0 rows → throws, tx never sent (record-before-send).
- `settle` (`intents.ts:285-299`): `WHERE status='pending' OR ($2='submitted' AND status='failed')`: a landed tx overrides a reconcile `failed`; never `submitted → failed`.
- Caps (`intents.ts:247-281`), all rolling 24 h, counting `status <> 'failed'`: `MAX_DEPOSIT` 1 000 USDC, `DAILY_DEPOSIT_LIMIT` 5 000 USDC per user, `DAILY_DEPOSIT_LIMIT_GLOBAL` 100 000 USDC under advisory lock `'deposits'`; promo `MIN_PROMO_PAYOUT` 1, `MAX_PROMO_PAYOUT` 1 000, `DAILY_PROMO_LIMIT` 5 000 USDC under lock `'promo_payouts'` (defaults `config.ts:56-66`). No relay cap on withdrawals or bets (program enforces).

- [ ] [race, INV-34] N concurrent `submit` with the same id → `execute` runs ≤ 1 time (same user and different users).
- [ ] [replay, INV-34] Same id, different user or any different action field → `INTENT_CONFLICT`; key-order permutations and UUID case → same `canonical`.
- [ ] [prize-squat, INV-48] **Shared id namespace for player intents and promo payouts**: `intentId: payoutId` (`app.ts:115`), one PK (`db.ts:29`); `get(id, promo)` filters by type (`intents.ts:148-153`). Prize ids are deterministic `uuidv5(PRIZE_NAMESPACE, "<competitionId>:<kind>:<rank>")` (`apps/api/src/competitions/uuid.ts:23-26`) and play `intentId` is client-chosen (`apps/api/src/schemas.ts:142`). A player who pre-uses a future prize id makes the payout `INTENT_CONFLICT` forever. Lead (verify end to end via `apps/api/src/competitions/payouts.ts:93-107`); fix needs both zones.
- [ ] [index, INV-35] Partial index predicate still covers `withdraw`, `deposit`, `open_account`, every game move. Any narrowing (e.g. excluding withdraw) leaves only the program balance check. Keep a regression test.
- [ ] [caps-race, INV-38] N parallel deposits across users near the global cap → total ≤ cap (global lock taken inside the per-user xact; order user→global everywhere, no deadlock).
- [ ] [false-failed, INV-36/38] A **false `failed`** frees quota and the player lock: "interrupted before sending" (unsent > 180 s) and `expired` (height > lvbh + 150). Any path that marks failed a tx that later lands = cap bypass + duplicate deposit on retry with a new id. Check `settle` flip logs `intent settled differently by reconciliation`.
- [ ] [refusal, INV-34] Refusals record nothing: `CONSENT_REQUIRED`, `PLAYER_BUSY`, `LIMIT_EXCEEDED` leave no row (the api relies on it, §2).
- [ ] [canonical, INV-34] `canonical()` (`intents.ts:60-67`) vs JSONB round-trip: numbers/strings/booleans in `action` survive JSONB unchanged (amounts are strings; check no numeric field loses precision).
- [ ] [players-unique, INV-34] Low priority: `players.address` is `UNIQUE` (`db.ts:23`) but both upserts use `ON CONFLICT (user_id) DO NOTHING` (`players.ts:45-48`, `executor.ts:18-21`). Two Privy users resolving to one address raise an unhandled unique violation: inside `execute` it becomes a stored `failed NETWORK_ERROR` (`intents.ts:115-122`); via `GET /users/:id` it is a generic 500, which the api maps to `UPSTREAM_ERROR` (`apps/api/src/relay.ts:64-66`). Confirm neither path executes anything or burns the id unexpectedly.
- [ ] [locks] Advisory lock key space: `hashtextextended(userId,0)` shares the 64-bit space with `'deposits'`/`'promo_payouts'` (collision only over-serializes). Note only.
- [ ] [audit-trail, new: propose INV] The `intents` row is mutable (status/error overwritten), no append-only history, `action` JSONB unconstrained at DB level. Report as Info unless a concrete abuse exists.
- [ ] [errors, INV-53] `SAFE_MESSAGES` + `safe()` (`intents.ts:86-113`): stored/returned messages are fixed per code, `PROGRAM_ERROR` carries only the Anchor error name. A new code without a safe message?

## 7. Transaction building from untrusted input (`chain.ts`) [INV-39, INV-42]

Send paths: `sendRollup` (`chain.ts:648-663`, relayer fee payer + signer, polls ≤ `ROLLUP_CONFIRM_MS` 5 s; a confirmed tx with `err` → `IntentError(PROGRAM_ERROR)` `:657-659`) and `sendBase` (`chain.ts:667-681`, relayer fee payer, optional Privy player signature, then `partialSign(relayer)`). Both go through `simulateRecordSend` (`chain.ts:632-645`): `simulateTransaction` → program error = `IntentError(PROGRAM_ERROR)`, nothing sent → `record()` → `sendRawTransaction(skipPreflight)`; failure after record = `UnconfirmedError` (stays `pending`).

| Builder | Signers | Accounts from | Pointer |
|---|---|---|---|
| `openAccount` | relayer (payer) + player (Privy) | PDAs(player), `vault.treasury`, ATA(`vault.mint`, player); `maxWin` = program max | `chain.ts:260-287` |
| `deposit` | relayer (fee) + player (Privy) | ATA(`vault.mint`, player), vault PDAs | `chain.ts:289-304` |
| `play` (game moves) | relayer | `playerAccount/ledger/table/board` PDAs, `VRF_QUEUE`, `seed()` | `chain.ts:311-326`, `560-626` |
| `withdraw` (rollup) | relayer | ATA(`vault.mint`, player) unchecked in rollup (`withdraw.rs:39-40`), re-checked on Solana `token::authority = ledger.player` (`withdraw.rs:108`) | `chain.ts:612-626` |
| `raiseWinCap` | relayer, `withoutRecord` | ledger PDA | `chain.ts:332-345` (+ `sendRaiseWinCap` `:347-358`) |
| `ensureGameAccount` | relayer, `withoutRecord` | game PDAs | `chain.ts:394-410` |
| `payPromo` | relayer | ATA(`vault.mint`, player) (`:425`) + `createAssociatedTokenAccountIdempotent(payer=relayer)` | `chain.ts:423-440` |
| `expireRound`, `checkpoint` | relayer, `withoutRecord` | PDAs | `chain.ts:364-388`, `443-448` |

- [ ] [accounts, INV-39] **No request-supplied account.** For every `Action`, compiled account keys ⊆ {PDAs of `wallet.address`, vault fields, `VRF_QUEUE`, `PROGRAM_ID`, system/token/ATA programs, relayer}. Fuzz this (fast-check is not a dependency today: say so in the PoC plan).
- [ ] [wallet-source, INV-39] `wallet.address` source: DB cache or Privy. Anything that poisons the `players` row redirects promo destination and moves played on the wrong PDAs (§10 DB row).
- [ ] [player-sign, INV-39/41] Player key signs only `open_account`/`deposit` txs, whose instructions are all Tilt instructions of those types (+ table open/delegate for open). Any extra instruction in a player-signed tx (ComputeBudget, ATA create) must be justified and covered by the policy.
- [ ] [win-cap, INV-42] Win-cap raise driven by simulation logs: `winCapShortfall` regexes `Win cap short by (\d+)` over sim logs (`chain.ts:127-133`, log emitted at `state.rs:364`); only for `STAKING_MOVES`; one retry per submit: `play`'s catch (`chain.ts:320-324`) calls `raiseWinCap` (`:332-345`) by `seen.maxWin + short − ledger.maxWin` when > 0. A lying RPC can inflate `short`; the program bounds one raise by `max_round_gain` and `free` (`state.rs:124-145`).
- [ ] [win-cap-release, INV-02/11] **Lead (verify): where is a `max_win` reservation released?** `apply_checkpoint` only releases newly forfeited **losses** (`withdraw.rs:265-285`: `vault.reserved -= released`), and the ER cap only ratchets up (`sync_ledger` takes `max`, `state.rs:357`). The relay checkpoints only on an unapplied forfeit or a loss ≥ `CHECKPOINT_MIN_LOSS` (`sweeper.ts:61`). The prior audit ("Modèle de confiance") says `max_win` resets at each checkpoint: reconcile that claim with the code. If a winning or break-even player's raised cap is never released (check the withdraw payment path too), quantify `vault.reserved` growth per USDC staked with repeated high-multiplier stakes until `VaultTooSmall` for everyone.
- [ ] [rent, new: propose INV] `ensureGameAccount` runs **before** the move's own simulation (`chain.ts:314`): a stake the program would refuse still opens and delegates the game account (relayer rent). Bounded per player by the number of game accounts; cached in-memory (`gameAccountsReady`, `chain.ts:225`), so lost on restart.
- [ ] [no-record, INV-36] `withoutRecord` sends (`chain.ts:208`): raise, game-account opens, expire, checkpoint. None may move player USDC; confirm no money-moving tx uses `withoutRecord`.
- [ ] [sim-vs-exec] Simulation vs execution: state can change between `simulateTransaction` and landing (another tx, rollup lag). Anything relying on simulation as a guard must also be enforced by the program.
- [ ] [preflight, INV-36] `skipPreflight: true` after a successful simulate: fine, but a tx recorded then rejected at send stays `pending` until reconcile; verify it ends `failed` (not stuck) when it never landed.
- [ ] [expiry, INV-35/36] Blockhash/expiry: `lastValidBlockHeight` stored per intent; on the rollup, block-height semantics may differ from Solana (lead, verify on devnet rollup). Durable nonces: not used (verify `rg -n "nonce" apps/wallet/src`).
- [ ] [open] `isOpen` pre-check (`chain.ts:261`) is advisory; the on-chain `init` is the real guard against a second open.

## 8. Fee payer and escrow drain (relayer SOL) [new: propose INV "relayer cost per attacker request ≤ attacker cost"]

The relayer pays: every Solana and rollup fee; rent of `PlayerAccount`, `Ledger`, bjtable at open (`account.rs:38`: "repaid in USDC from the deposit" via the onboarding fee, never in SOL); up to 5 more game accounts per player on first staking move; `PromoPayout` rent (never closable, prior I6) + ATA rent per promo; every `raise_win_cap`; sweeper expire/checkpoint fees; MagicBlock escrow for each withdraw / checkpoint Magic Action.

- [ ] [sybil-rent] Cost per Sybil: one `open_account` (> onboarding fee in USDC) → SOL rent of all accounts + one staking move per game. Compute SOL spent vs onboarding fee; only api rate limits throttle account creation (INV-50).
- [ ] [sybil-sweep, INV-63] **Sweep cost is O(players), serial**: every 30 s the sweeper visits every player with a `submitted` `open_account` one by one, with 1-3 RPC calls each (`fetchPlayerAccount`, `fetchLedger`, maybe a send) (`sweeper.ts:39-70`). Sybil accounts stretch one sweep; the in-memory re-entrancy guard (`main.ts:58-72`) then skips cycles, delaying expire of stuck draws and checkpoints for real players (funds frozen longer). `severity.md` §7 never excludes funds-freeze DoS: estimate sweep duration per 1 000 accounts.
- [ ] [promo-rent] Promo spam with API key: `MIN_PROMO_PAYOUT` 1 USDC × `DAILY_PROMO_LIMIT` 5 000 → up to 5 000 `PromoPayout` rents + ATAs per day.
- [ ] [raise-loop, INV-42] Refused stakes and repeated `WinCapReached` loops: each costs a raise tx even if the move then fails.
- [ ] [escrow] Checkpoint frequency: `CHECKPOINT_MIN_LOSS` 1 USDC, `CHECKPOINT_INTERVAL_MS` 1 h (`config.ts:70-72`) → escrow cost per active player per hour.
- [ ] [alerts, INV-63] `LOW_RELAYER_SOL` (< `MIN_RELAYER_LAMPORTS` 0.5 SOL), `LOW_ESCROW` (< 0.002 SOL) are log lines only; no auto-pause, no burn-rate alert. Running out = all deposits, plays, withdraws and checkpoints stall (availability, players' funds stuck).
- [ ] [priority-fee] Can any request make the relayer pay a priority fee or a compute budget chosen by input? (Today: no ComputeBudget instruction from input; verify.)

## 9. Background jobs: sweeper, monitor, executor, reconcile [INV-35, INV-36, INV-27, INV-63]

| Job | Trigger | Signs | Pointer |
|---|---|---|---|
| Boot check | start | — | refuses to start unless `vault.relayer == RELAYER_SECRET_KEY.publicKey` (`main.ts:31-34`) |
| Sweeper | `setInterval(CRON_INTERVAL_MS` 30 s), in-memory re-entrancy guard, "sweep stuck" log after 5 min | relayer | `main.ts:58-72`, `sweeper.ts:29-72` |
| Reconcile | first step of each sweep | — | `intents.ts:177-204` |
| Monitor | separate timer, own guard; alerts = `console.error` JSON lines (stderr) | reads only | `main.ts:74-86`, `monitor.ts` |
| Shutdown | SIGTERM/SIGINT | — | `main.ts:88-97`: in-flight executions can be cut → left `pending` → reconcile |

Sweeper (`sweeper.ts`): reconcile (failure caught, `:32-36`) → `fetchVault()` **outside any try** (`:37`) → for each player **whose `open_account` intent is `submitted`** (`:39-42`): `expireRound` if `AwaitingDraw` and `now − lastAction ≥ round_timeout_secs` (`:51-54`); else checkpoint if idle, interval elapsed, and (`unapplied` or loss ≥ `CHECKPOINT_MIN_LOSS`) (`:56-64`). Per-player try/catch (`:45-69`).

Reconcile: pending rows older than 180 s without signature → `failed` "interrupted before sending"; with signature, older than 120 s → `transactionStatus` (`chain.ts:452-461`: height read first, then `getSignatureStatuses(searchTransactionHistory)`; `expired` only when `height > lvbh + 150`). Update guarded by `signature IS NOT DISTINCT FROM <read value>` (`intents.ts:193-196`).

- [ ] [slow-exec, INV-36] **Unsent timeout vs slow executions**: a play can spend `ensureGameAccount` (base confirm + 20 s rollup wait) + `raiseWinCap` (base confirm + `WIN_CAP_READY_MS` 20 s) + Privy (20 s, 1 retry) before `record`. Over 180 s → reconcile marks `failed`, frees the player lock and deposit quota; `record` then refuses to send (fail closed). Verify nothing money-moving is sent outside `record` in that window.
- [ ] [clock, INV-36] `updated_at` is the clock for both thresholds; `record` bumps it. Can a row stay "fresh" forever or flip between branches?
- [ ] [busy-forever, INV-35] **`PLAYER_BUSY` held indefinitely**: a recorded tx stays `in_flight` until rollup `height > lvbh + 150`. If rollup heights do not behave like Solana's, or the rollup RPC errors persistently, the player is blocked from all moves, deposits and withdrawals (only a `STUCK_INTENTS` warning after 600 s). Lead (verify) on devnet rollup.
- [ ] [withdraw-status, INV-36; new: propose INV "withdrawn means paid"] **Withdraw status ≠ payment.** A `withdraw` is marked `submitted` once the **rollup** tx confirms (`chain.ts:612-626`, `:657-659`); the USDC transfer on Solana is a later Magic Action. Check: does the api/web/monitor show "withdrawn" before the payment lands? Who detects a failed or never-executed Magic Action (no relay job reads `ledger.withdrawn_paid` or payment events)? The partial index releases at `submitted`, so a second withdraw can start while the first payment is pending: confirm the program's withdraw accounting covers it. Magic Action side: `rollup-vrf-checklist.md` §3 and §8.
- [ ] [rpc-trust, INV-36/42/63] **RPC trust**: a lying/lagging RPC can report `expired` for a landed tx (false `failed` → quota released, history wrong), spoof sim logs (win-cap raise, §7), lie to the monitor (solvency). Multiple load-balanced nodes = non-monotonic heights.
- [ ] [coverage] Sweeper coverage: accounts opened while the row says `failed` (false negative) or outside the relay are never expired/checkpointed → bankroll stays reserved, stuck draws never retried.
- [ ] [rerolls-house, INV-27] `expire_round` re-requests VRF: the relay chooses when. Prior audit: with a small `round_timeout_secs` (1 s accepted) the house could re-roll a draw after seeing the oracle answer. Check the relay never expires a round whose callback is merely slow, and `PlayerTurn` rounds are never expired (`sweeper.ts:50-51`).
- [ ] [reroll-player, INV-27/28] **Lead (verify), attack-playbook X1**: the sweeper expires **every** `AwaitingDraw` round past `round_timeout_secs` with no check on why the draw is stuck (`sweeper.ts:51-54`), and `expireRound` re-requests with a fresh relay `seed()`. Can a player make the VRF callback fail as a function of the randomness (compute, account state, game-specific panic), or read the answer from the failed callback, then get an automatic free re-roll of losing draws? Cross-check with `rollup-vrf-checklist.md` §6.
- [ ] [checkpoint, INV-02] Checkpoint correctness: `unforfeitedLoss` mirrors the program's `unforfeited_loss` (`sweeper.ts:24-27`); a mismatch only changes timing (program decides). `last_checkpoint_at` written only after success (`:62-63`).
- [ ] [multi-instance] Multiple relay instances: guards and `gameAccountsReady` are in-memory, no leader election → duplicate expire/checkpoint (program rejects duplicates; costs fees). Two concurrent submits for one player are blocked by the index.
- [ ] [monitor, INV-01/63] Monitor (`monitor.ts:40-58`): `INSOLVENT` (vault token balance < `vault.reserved`), `LOW_FREE_BANKROLL`, `LOW_RELAYER_SOL`, `LOW_ESCROW`, `STUCK_INTENTS` (> 600 s, `monitor.ts:37`), `PAUSED`; failure → `MONITOR_FAILED` critical (`monitor.ts:80-85`). Gaps: alerts are stderr JSON lines (`main.ts:81`), no pager integration; no withdraw-velocity or burn-rate alert; no auto-pause.
- [ ] [frozen, INV-63] **USDC freeze not detected** (attack-playbook G-A1): the monitor reads `getAccount(vaultTokenAddress())` (`monitor.ts:65`) but ignores `isFrozen`, and never reads `promo_token` (balance or freeze; prior F11). A Circle freeze of the vault or promo pool stalls every deposit, withdraw and promo with no specific alert.
- [ ] [kill-switch, INV-62] No relay-side freeze flag read per request: containment is the program pause plus swapping the Privy policy to deny-all. Lead: report as an ops gap if the runbook has no one-command path.
- [ ] [executor, INV-37/39] Executor (`executor.ts:14-32`): `players.find` → `UNKNOWN_USER`; upsert `ON CONFLICT DO NOTHING` (`executor.ts:18-21`) so a poisoned `players` row persists; `default:` branch sends everything else to `chain.play`, including `withdraw`. A new money action falling into `default` would skip player signing and caps.

## 10. Leaked-key blast radius (insider lens: assume one is compromised) [INV-40, INV-41]

Secrets held by the relay (`config.ts:37-77`; names only, never read values): `RELAYER_SECRET_KEY`, `RELAY_API_KEYS`, `PRIVY_APP_ID` + `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `DATABASE_URL`. Runbook procedures: `docs/runbook.md:35-39`.

Rating rule (`severity.md` §3): key-holder entry → report **only the missing second barrier**, rated per A4 (one level below the money it exposes, flagged "needs leaked key"). A5/A6 entry → `Info` "trust assumption" (exclusion X2) unless Tilt code makes it worse or a lower rung reaches that power.

| Leaked | Rung | Attacker can | Bounded by | Cannot | Second barrier missing? (verify) |
|---|---|---|---|---|---|
| `RELAY_API_KEYS` (or compromised api) | A4 | play any open player's balance (no consent for moves); trigger `raise_win_cap` per staking move; promo payouts to any registered user; read any user's address and any intent; Privy quota burn via `/users/:id` | promo: `MAX_PROMO_PAYOUT` 1 000, `DAILY_PROMO_LIMIT` 5 000 USDC/24 h + on-chain pool caps; deposits/withdrawals need a fresh identity token | deposit or withdraw without consent; withdraw elsewhere than the player's ATA | no per-user move rate limit or bet cap at relay; runbook `:39` omits gambling-away and bankroll-lock risk |
| `RELAY_API_KEYS` + a sniffed identity token (≤ 5 min) | A4 | unlimited deposits (caps) and withdrawals to the player's own ATA for 5 min | deposit caps; program withdraw limits/holds | redirect withdrawals | token not single-use, not bound to amount (INV-37) |
| `PRIVY_APP_SECRET` + `PRIVY_AUTHORIZATION_KEY` | A4 | get Privy to sign any tx whose every instruction is a Tilt instruction, for every wallet that added the quorum; reachable alone: `deposit`, `fund_vault`, `fund_promo` (fee paid by any attacker key) | Privy policy (program id only) | plain SPL/SOL transfers, policy update (live-tested); `open_account` (needs relayer co-sign, `account.rs:38-40`) | **lead (verify)**: wallet USDC swept into vault/promo pool → **High (A4, needs leaked key)**; Critical only if an A0-A2 path reaches Privy signing (e.g. a wallet whose signer was added without `policyIds`, §3) |
| `PRIVY_APP_SECRET` alone | A4 | enumerate users/wallets; read linked accounts (PII) | — | sign (needs authorization key; depends on wallet owner model: verify) | — |
| `DATABASE_URL` (write) | A4 | rewrite `players` row (victim `userId` → attacker address): victim's **promo prizes paid to the attacker's ATA** (`chain.ts:425`), victim's moves played on the attacker's PDAs; funding address redirected **only** for users without an api cache row (`apps/api/src/wallets.ts:13-14`, set once); delete intents → caps reset; flip statuses → hide history | promo: `MAX_PROMO_PAYOUT` / `DAILY_PROMO_LIMIT` + pool caps; deposits fail closed (Privy signs by `wallet_id`, `players.ts:59-60` throws if no signature for the poisoned address) | sign anything; change on-chain state; redirect withdrawals (`ledger.player`) | no re-check of address vs Privy at use time (prior F9); no append-only audit log. Cross-DB variant (api `users.solana_address`): attack-playbook X5 |
| `RELAYER_SECRET_KEY` | A5 | sign every rollup move for every player; `raise_win_cap` (bankroll lock); `pay_promo` to **any** USDC token account (`promo.rs:163-164`) up to pool caps; spend relayer SOL and escrow; expire/re-roll stuck draws, including **selective expire of the attacker's own rounds → positive EV, bounded per player** (attack-playbook X7); skip all relay caps | program: bet limits, win caps, pool daily cap (2× around a window boundary), payouts only to `ledger.player` ATA | move vault USDC to itself; withdraw a player's balance elsewhere | old key accepted in rollup until the `Vault` clone refreshes (prior L1): pause first |
| Relay host (RCE / malicious dependency) | A5 (A3 if outsider-reachable) | all of the above combined (all secrets in one env, `main.ts:29,36-37`) | program caps only | exceed on-chain caps | raw keypair in env, full npm tree in the signing process |
| Rollup validator / RPC | A6 | lie on status, heights, sim logs | program on Solana re-checks withdraw payments | pay a withdrawal to a wrong ATA | relay trusts RPC for reconcile and monitor (§9) |

## 11. Previous audit findings to re-check (`docs/audits/2026-10-13-chain-relay.md`)

Re-verify each at the target commit; regressions are findings. The status column is what the code looked like at `d559a31`, **not** proof: re-read before relying on it.

| ID | Claim / fix | Where to check now | Claimed status at `d559a31` (re-verify) |
|---|---|---|---|
| F1 | consent token required for `open_account`/`deposit`/`withdraw`, ≤ 5 min, own user; + global deposit cap | `consent.ts:33-49`, `app.ts:97`, `intents.ts:258-266` | fixed; moves still need no consent (by design) |
| F2 | `MAX_PROMO_PAYOUT` + `DAILY_PROMO_LIMIT` under lock | `intents.ts:269-281` | fixed |
| F3 | one RPC error must not stop the sweep | `intents.ts:186-201`, `sweeper.ts:32-37,45-69` | fixed for reconcile and per-player work; `sweeper.ts:37` `fetchVault()` still aborts the whole cycle (transient, availability only) |
| F4 | monitor on its own timer, `MONITOR_FAILED` | `main.ts:74-86`, `monitor.ts:80-85` | fixed |
| F5 | rollup intent missing from `getSignatureStatuses` history marked failed then replayed | `chain.ts:452-461` | refuted on local stack; re-verify on devnet rollup |
| F6 | 8 KiB body limit → 413 | `app.ts:51,69` | fixed |
| F7 | `PrivyUserId` validation | `relay.ts:151`, `app.ts:82` | fixed |
| F8 | raw internal error text stored/returned | `intents.ts:86-113`, `app.ts:128-131` | fixed |
| F9 | Privy wallet cache never refreshed | `players.ts:30-35` | open (feeds §3 cache-on-lookup, §10 DB row) |
| F10 | promo shares the in-flight lock | `db.ts:46-49` | fixed |
| F11 | promo pool unmonitored; `/health` unauthenticated | `monitor.ts`, `app.ts:71-74` | open |
| L1 | old relayer key accepted in rollup until vault clone refresh | `docs/runbook.md:35` | runbook only |
| I6 | `PromoPayout` never closable (rent) | `promo.rs` | open (rent drain, §8) |

Contract changes from that audit to keep: `PrivyUserId` regex, `IntentRequest.consent?.identityToken`, `LIMIT_EXCEEDED` (422) for global deposit and promo caps, 413 above 8 KiB, fixed error messages (except Anchor name for `PROGRAM_ERROR`), `consume_randomness` seeds in IDL.

## 12. Invariants to test and PoC hooks

Relay invariants (cite the INV id in the finding's `invariant` field):
- INV-34: at-most-once execution per `intent_id` under any interleaving.
- INV-34: replay binding: same id + different user/action → `INTENT_CONFLICT`; same → stored response, no re-execution, no cap re-check.
- INV-35: one non-promo pending intent per user; promo never causes or waits on `PLAYER_BUSY`.
- INV-36: record-before-send: no `sendRawTransaction` unless the signature row was written while `pending`; a row settled `failed` is never sent afterwards.
- INV-36: never `failed` if landed (eventually `submitted`); status moves only `pending → {submitted, failed}`, `failed → submitted`.
- INV-38: rolling caps hold for every interleaving (counting `pending` + `submitted`).
- INV-34 (new: propose INV text for the cross-zone contract): refusals (`CONSENT_REQUIRED`, `PLAYER_BUSY`, `LIMIT_EXCEEDED`) leave no row, and only those are forgotten by the api.
- INV-37: money actions execute only with a verified token of exactly that `userId`, `iat` ≤ 300 s, in this request (replays included); token never stored or logged.
- INV-39 (+ INV-41 for player signing): no request-supplied account in any relay tx; fee payer always the relayer; player signs only open/deposit txs.
- INV-42: win-cap raise only for `STAKING_MOVES`, at most one per submit, never for non-staking moves.
- INV-01 / INV-63: `vault_token.amount ≥ vault.reserved` always; monitor failure is itself critical.
- INV-48: a player intent id can never block a prize payout id. INV-50: every relay-reaching route is rate limited upstream.

Existing tests (extend, do not duplicate): `apps/wallet/test/intents.test.ts` (idempotency, conflict, one-in-flight, settled-while-executing, reconcile, caps incl. concurrent, promo mid-round, HTTP auth/validation/consent), `test/chain.test.ts` (tx construction, game accounts, win cap), `test/monitor.test.ts`, `test/relay.e2e.ts` (local stack), `test/privy.live.ts` (manual, real Privy dev app), `packages/contract/src/{relay,program}.test.ts`.

Known gaps worth a PoC/regression test:
- `PrivyConsentVerifier` unit tests (wrong app, access token as identity token, malformed JWT, future `iat`).
- `privy.live.ts`: player-signed `fund_vault`, `fund_promo`, oversized `deposit`, attacker key as fee payer, v0 tx with ALT, `signAndSendTransaction` / `signMessage` / export with the relay quorum → each must be refused by Privy.
- Cross-zone refusal contract: for each api `NOT_RECORDED` code and `INTENT_CONFLICT`, the relay DB has no new row / the id cannot re-execute.
- Promo/play id collision (INV-48): play intent with a future prize id, then promo payout with that id.
- Reconcile vs slow executor: inject > 180 s delay before `record`; assert nothing sent, quota accounting consistent.
- Lying RPC fake: height jump (false `expired`), spoofed `Win cap short by <huge>` log.
- fast-check (not a dependency today): `Action` → `playTransaction` account keys ⊆ allowed set; `Amount` round-trip; `canonical` permutation invariance.
- Sybil cost: open + one stake per game → relayer SOL spent vs onboarding fee; sweep duration vs player count; repeated high-multiplier stakes → `vault.reserved` growth.

Commands. Never read `.env*` values; devnet read-only; mainnet never.

**Hunters (read-only; runs existing tests only, against an already running `tilt-pg`, docs/dev.md §1):**
```sh
pnpm --filter @tilt/contract typecheck && pnpm --filter @tilt/contract test
pnpm --filter @tilt/wallet typecheck
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet test
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet test test/intents.test.ts -t "one intent in flight"
```
IDL drift: CI already enforces it (`.github/workflows/chain.yml:84-88`); hunters do not run `sync-idl.sh` (it overwrites `packages/contract/src/idl/tilt.{json,ts}`, `chain/scripts/sync-idl.sh:11-12`).

**`sec-poc-engineer` only (isolated worktree, local stack; these start containers, write build output and send transactions):**
```sh
pnpm install --frozen-lockfile
docker run -d --name tilt-pg -e POSTGRES_PASSWORD=tilt -e POSTGRES_DB=tilt_test -p 55432:5432 postgres:17   # docs/dev.md §1, if not running
solana-keygen new --no-bip39-passphrase -o /tmp/tilt-admin.json      # throwaway admin key, docs/dev.md:38
(cd chain && anchor build --ignore-keys)
diff chain/target/idl/tilt.json packages/contract/src/idl/tilt.json && diff chain/target/types/tilt.ts packages/contract/src/idl/tilt.ts   # IDL drift, writes nothing
ANCHOR_WALLET=/tmp/tilt-admin.json scripts/local-stack-macos.sh      # Linux/CI: chain/scripts/local-stack.sh; keep running
ANCHOR_WALLET=/tmp/tilt-admin.json pnpm --filter @tilt/chain e2e     # local-only guard (chain/scripts/e2e.ts:691); sets up vault, relayer, test USDC
# relay e2e reads BASE_RPC/ER_RPC/ER_WS from env with no local-only guard (test/relay.e2e.ts:46-48): always pin them
BASE_RPC=http://localhost:8899 ER_RPC=http://localhost:7799 ER_WS=ws://localhost:7800 \
  ANCHOR_WALLET=/tmp/tilt-admin.json TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet e2e
```
`pnpm --filter @tilt/wallet privy:live` hits a **real Privy dev app**: it creates a Privy user, attempts `policies().update` on the configured policy (`privy.live.ts:110-113`) and can run against devnet. Dev app + local stack only, explicit human approval, never prod credentials.

Useful greps (read-only):
```sh
rg -n "app\.(get|post|use)\(" apps/wallet/src/app.ts            # route order vs auth middleware
rg -n "sendBase\(|sendRollup\(|withoutRecord" apps/wallet/src    # every send path
rg -n "NEEDS_CONSENT|STAKING_MOVES|intents_one_pending" apps/wallet/src
rg -n "NOT_RECORDED|INTENT_CONFLICT|refusal\(" apps/api/src      # api side of the refusal contract
rg -n "passthrough|strict\(" packages/contract/src/relay.ts
rg -n "fund_vault|fund_promo|Signer<'info>|payer = " chain/programs/tilt/src/instructions   # what a player signature can do
rg -n "DELETE FROM intents|UPDATE players|INSERT INTO players" apps   # history / mapping mutations
rg -n "isFrozen|promoToken|promo_token" apps/wallet/src/monitor.ts   # freeze / promo monitoring
```

## 13. Do not report (false positives at this layer)

- Relay routes reading any user's intent/address (`GET /intents/:id` `app.ts:103-108`, `GET /users/:id` `:81-89`): not a relay finding by itself (API key required). **Report it (zone eli, layer cross-layer) if any api route forwards a player-supplied `intentId`/`userId` to the relay without first binding it to the session user.** Today's bindings: `apps/api/src/intents.ts:80` (`row.user_id !== userId` before `getIntent` `:82`), called from `apps/api/src/routes/mod.ts:74` and `apps/api/src/routes/web.ts:121`; `walletOf` uses the session `userId` (`apps/api/src/wallets.ts:8-15`).
- `iat` parsed by hand after `verifyIdentityToken` on the same string (`consent.ts:25`): safe as long as verify runs first.
- `withdraw.player_token` unchecked in the rollup (`withdraw.rs:39-40`): re-checked on Solana in `PayWithdrawals` (`withdraw.rs:108`). Report only if you show the Solana check bypassed.
- Promo `payoutId` replay after DB wipe: blocked on-chain by the `PromoPayout` PDA `init` (`promo.rs:161`).
- Advisory-lock hash collisions: over-serialize only.
- `skipPreflight` after an explicit `simulateTransaction`: intended.
- Relayer as sole rollup signer, no escape hatch, single admin key until Squads: known design decisions (prior audit "Modèle de confiance"); report only a new concrete consequence.
- Generic "add rate limiting / TLS / KMS" without a Tilt attack path and impact: put in `coverage.leads`, not findings.
