# api checklist (`apps/api`, Eli's zone)

Pointers read at `eli/prod-review` @ `d559a31` (2026-10-19). Paths are relative to `apps/api/src` unless they start with `apps/`, `packages/`, `docs/` or `test/` (= `apps/api/test`).

**Nothing in this file is evidence.** Hunters re-read and re-trace at HEAD before filing. Refuters must never cite this file as proof that a bug exists or as a blocking defence; cite code only. Severity comes from `severity.md`, not from the guess column. Code comments state intent; verify that the trade-off still holds. Cross-zone items (relay `apps/wallet`, `packages/contract`) are context: report them to Armand / both, do not edit.

Which pointers to distrust: `git diff --stat d559a31..HEAD -- apps/api packages/contract apps/wallet/src` (every touched file: re-locate the lines).

Check first: H1 prize-id squatting (§5) · H5/H5b indexer completeness (§8) · H2/H3 who wins prizes (§7-§8) · auth + geo route matrix (§1.2, §6.1) · HS-1 hidden-state reads (§8.1).

How to use per lens:
- `checklist`: walk §1-§13 top to bottom.
- `attacker-goal` / red team: start from §14 leads and the money paths below; chain api weaknesses with relay/chain ones.
- `invariant-breaker`: take §15 and build a request sequence (often N parallel) that breaks one.
- `differential` (PR): for each touched file, re-run its section plus §15. Set `introduced_by_diff=false` for any §14 lead that predates the diff.
- `insider` (sec-insider): start at §9 risk framing, §10.1 secrets, then H11, H14, H17, WA-10 and the leaked-`RELAY_API_KEY` chain; measure which second barrier is missing.
- refuter lenses (`code-truth`, `exploitability`, `impact`): §1.1/§1.2 and the "Checks" bullets are an index of **where** defences may live; open the code at HEAD and quote it. Never quote this file.

Reporting (maps to the HUNT schema):
- pass → `coverage.units_checked`, e.g. `"§2 approve race: ok (auth/device.ts:84-89)"`.
- fail with a concrete path → `findings[]` (quote code at HEAD).
- suspicion → `coverage.leads`, with the lead id (H1…) and the question that would decide it.
- not checked → `coverage.not_covered` with the § number.

What the api can and cannot do (calibrate impact before rating):
- It signs nothing (`chain.ts` uses a throwaway keypair for reads). It influences money in three ways: (a) forwarding intents to the relay (`relay.ts`); (b) the admin CLI asking the relay for promo payouts (`competitions/payouts.ts`); (c) **choosing the Privy signer and policy the web attaches to every player wallet**: `GET /v1/account` returns `privySigner: {signerId: PRIVY_KEY_QUORUM_ID, policyIds: [PRIVY_POLICY_ID]}` (`routes/web.ts:75`), and the web calls `addSigners` with exactly those values (`apps/web/app/(site)/(wallet)/account/DepositPanel.tsx:101-102`). See H17.
- Relay + program re-check every player money move. So api bugs are usually: limit bypass, responsible-gaming failure, DoS/griefing, wrong or blocked prize payouts.
- Exception: **sponsor prizes**. The api (`prizes` table + admin CLI) decides recipient and amount; the relay only caps (`MAX_PROMO_PAYOUT` default 1,000 USDC, `DAILY_PROMO_LIMIT` default 5,000 USDC, `apps/wallet/src/config.ts:64,66`). Anything that writes or influences `prizes` is money code.
- The relay trusts the api's `userId` for rounds and `promo_payout`; it re-checks consent only for `open_account | deposit | withdraw` (`apps/wallet/src/consent.ts:33`). An api bug letting a caller choose `userId` = play as anyone.

## 0. Do not report as findings (unless…)

| Behaviour | Why accepted | Cite | Becomes a finding when |
|---|---|---|---|
| Withdraw not geo-blocked, not guarded by limits/exclusion, no advisory lock (`routes/web.ts:109-117`) | spec: a player can always take money out | X1 | the destination can change, or relay per-player serialization is gone |
| `/health` before rate limits (`app.ts:42-44`) | LB must not drop a healthy instance | X9 (Low) | it does more than `SELECT 1`, or flood → pool starvation is shown (H8) |
| No CSRF protection | bearer auth, no cookies (`app.ts:33-41`) | X9 | Privy cookies get enabled, or any route reads a cookie (WA-12) |
| `PRIVY_KEY_QUORUM_ID` / `PRIVY_POLICY_ID` in `/v1/account` | not secrets | — | someone can change them (H17: integrity matters, not secrecy) |
| Relay has no rate limit | private network + API key | X2 | the relay is reachable from the internet |
| Guessing another player's intent id | mod uses `crypto.randomUUID()` (`apps/mod/hooks/register.tsx:538`) | X6 | ids leak (logs, `/v1/state`, screenshots) or are derivable (H1 prize ids) |
| User-code brute force | 32^8 space, 600 s TTL, 5 tries/10 min/user | X6 | attempts are not bounded (bucket bypass, sybil × instance count materially changes odds) |
| `GET /v1/geo` reveals geo verdict | public oracle by design | X9 | it reveals the edge secret or a bypass |

Previously fixed (`docs/audits/2026-10-13-chain-relay.md`), **regression only — report if the fix is gone**: F1 consent token required for `open_account|deposit|withdraw` (relay), F2 promo caps, F6 8 KiB body limit, F7 `PrivyUserId` validation, F8 raw internal error text, F10 promo payouts excluded from the one-in-flight lock. Still open there (not regressions): F5, F9 (wallet cache never refreshed, see §3), F11 (`/health` unauthenticated).

## 1. Surface map

### 1.1 Middleware order (`app.ts:21-74`)

| # | Step | Line | Note |
|---|---|---|---|
| 1 | request log | 21-31 | logs `routePath`, not URL |
| 2 | `secureHeaders()` | 32 | api-side defaults only |
| 3 | CORS, single origin `WEB_ORIGIN` | 33-41 | bearer auth, no cookies |
| 4 | `GET /health` | 44 (`routes/public.ts:76-83`) | **before every rate limit**, `SELECT 1` per call |
| 5 | per-IP bucket `limiters.ip` (`clientIp`) | 47-50 | before global on purpose |
| 6 | global bucket | 51-54 | |
| 7 | `bodyLimit` 8 KiB → 413 | 55-61 | |
| 8 | routes; `notFound` 404; `onError` generic 500 for non-`ApiError` | 63-74 | |

### 1.2 Routes

| Route | File:line | Auth | Limits / guards | Geo |
|---|---|---|---|---|
| GET `/health` | routes/public.ts:76 | none | none (H8) | no |
| GET `/v1/leaderboard` | routes/public.ts:86 | none | ip+global; returns **competition id**, handles, seed hash, seed once closed | no |
| GET `/v1/rounds/:signature/verify` | routes/public.ts:105 | none | `SignatureParam`; CPU replay | no |
| GET `/v1/geo` | routes/public.ts:110 | none | | (oracle) |
| POST `/v1/auth/device` | routes/auth.ts:13 | none | `auth` 10/min per IP; DB insert + DELETE sweep | no |
| POST `/v1/auth/device/token` | routes/auth.ts:18 | device code | `play` per IP; 5 s per-code interval | no |
| POST `/v1/auth/device/approve` | routes/auth.ts:23 | Privy access | `auth` per user; `approveAttempts` 5/10 min per user, taken before parsing (:31) | **yes** (:26) |
| GET `/v1/state` | routes/mod.ts:49 | mod session | `token` per session | no |
| POST `/v1/play` | routes/mod.ts:51 | mod session | `token` per session, `play` per user, guard (exclusion; loss limit for `WAGERS`) | **yes** (:54) |
| GET `/v1/intents/:intentId` | routes/mod.ts:72 | mod session | owner check `intents.ts:80` | no |
| POST `/v1/impressions` | routes/mod.ts:79 | mod session | 60 s/min/user cap in SQL | no |
| GET `/v1/account` | routes/web.ts:89 | Privy access | `token` per user | no |
| POST `/v1/account/deposit` | routes/web.ts:91 | access + identity ≤300 s | `money` 6/min, guard (exclusion, daily deposit) | **yes** |
| POST `/v1/account/withdraw` | routes/web.ts:110 | access + identity ≤300 s | `money`; no guard, no advisory lock (§0) | no, by design |
| GET `/v1/account/intents/:intentId` | routes/web.ts:119 | access | owner check | no |
| GET / DELETE `/v1/account/sessions[/:id]` | routes/web.ts:126,130 | access | `WHERE id AND user_id` | no |
| PUT `/v1/account/limits` | routes/web.ts:136 | access | | no |
| POST `/v1/account/exclude` | routes/web.ts:141 | access | | no |

Auth wiring: mod routes get `modAuth` + per-session bucket through a per-path `app.use` loop (`routes/mod.ts:41-47`: `/v1/state`, `/v1/play`, `/v1/intents/*`, `/v1/impressions`). Web routes via `app.use("/v1/account/*")` (`routes/web.ts:82-86`, also matches `/v1/account`). This auth model is path-string based, so it is fragile:

- [ ] Every non-public route is covered by one of the two `use` registrations. A new mod route not added to the list at `routes/mod.ts:41` is **unauthenticated**.
- [ ] No handler is registered **before** the `app.use` meant to guard it (Hono runs handlers in registration order; check `app.ts` call order of `publicRoutes` / `authRoutes` / `modRoutes` / `webRoutes`).
- [ ] Path variants reach the same handler with the same middleware: trailing slash (`/v1/play/`), `//v1/play`, `%2F`, case (`/V1/Play`), `/v1/account-x`, `/v1/accounts`.
- [ ] `HEAD` on GET routes and any `app.all` / `app.on` handler carry the same middleware.
- [ ] Harness step (§17): iterate `app.routes`; for every non-public `(method, path)` (fill params with a valid UUID / signature) send no bearer, a Privy access token to mod paths, and a `tilt_` token to web paths → assert 401 each. Add path variants above to the same loop.

### 1.3 Background and ops
- Indexer (`indexer.ts`): websocket `onLogs(PROGRAM_ID, "confirmed")` (:176-182) + backfill every `INDEXER_BACKFILL_MS` (30 s) from a signature cursor. Writes `rounds`, `draws`, `indexer_cursor.indexed_through`.
- Admin CLI (`admin.ts`): `pnpm --filter @tilt/api admin <cmd>`. Auth = possession of `DATABASE_URL` (+ `RELAY_URL`/`RELAY_API_KEY` for `prize:pay`). No cron: prizes are paid only by an operator.

## 2. Device-code flow (mod login, RFC 8628)

Flow: mod `POST /v1/auth/device` → `{deviceCode (256-bit), userCode "WDJB-MJHT", verifyUrl /connect?code=…}` (`auth/device.ts:21-46`); player logs in on web, types the code, `POST /v1/auth/device/approve` (`routes/auth.ts:23-40`); mod polls `/v1/auth/device/token` and gets a 30-day `tilt_…` play-scoped token (`auth/device.ts:57-77`, `auth/sessions.ts:7`).

Checks:
- [ ] Device code and session token are 32 random bytes, stored only as sha256 (`auth/secrets.ts:5-9`); DB lookups by hash (`device.ts:63`, `sessions.ts:36-40`).
- [ ] Poll is single-use: row `FOR UPDATE`, `approved → consumed` in the same tx, expired or consumed → `expired` (`device.ts:59-76`). Expired-but-approved never yields a token (`:71` before `:72-75`).
- [ ] Approve is one conditional `UPDATE … WHERE user_code=$1 AND status='pending' AND expires_at > now()` with `rowCount === 1` (`device.ts:84-89`).
- [ ] Poll interval enforced per code (`too_soon`, `device.ts:62,68`); unknown codes rejected by regex before DB (`:58`).
- [ ] `approveAttempts` spent **before** parsing / DB (`routes/auth.ts:31`): N parallel guesses spend N tokens.
- [ ] Same 404 for unknown / expired / used code (`routes/auth.ts:35-37`): no enumeration oracle.
- [ ] User code: 8 chars over 32 symbols (`secrets.ts:12-19`), `b % 32` unbiased (256 = 8·32). TTL 600 s (`device.ts:11`).
- [ ] Web never auto-submits the link's code; player must type it (`apps/web/app/(site)/(wallet)/connect/ConnectFlow.tsx:17-29`; web-checklist).

Leads:
- **H4 lead (verify): device-code phishing (Storm-2372 pattern).** Attacker starts a login, sends the victim the `verifyUrl`, victim approves → attacker's mod holds a 30-day session on the **victim's** account. It cannot deposit/withdraw but can wager the balance. Gaps: `device_codes` stores no requester context (IP, time, UA) for the approve page (`device.ts:27-31`); no new-session notification; spec §10.5 says "jeton court et rafraîchissable", implementation is 30-day opaque, no rotation.
- **H10 lead (verify), DoS:** `startDeviceLogin` runs `DELETE FROM device_codes WHERE expires_at < now() - '1 day'` on every unauthenticated call (`device.ts:22`); no index on `expires_at` (`db.ts:48-58`) → seq scan per request. Combine with IP rotation (§6).

Tests (exists / missing): poll interval → 429 (exists, `test/auth.test.ts:70`); expiry incl. approved codes (exists, `:78`); approve race → one session (exists, `:109`); parallel wrong codes capped (exists, `:103`); 50 parallel polls of one approved code → one token, one `mod_sessions` row (missing).

## 3. Sessions, token scope, Privy tokens, consent

Checks:
- [ ] `modAuth` (`http.ts:112-120`) → `authenticate` (`auth/sessions.ts:34-49`): regex `^tilt_[A-Za-z0-9_-]{43}$`, then `token_hash` + `scope='play'` + `revoked_at IS NULL` + `expires_at > now()`. DB CHECK `scope = 'play'` (`db.ts:65`).
- [ ] `webAuth` (`http.ts:123-132`) → `privy.verifyAccessToken` (`privy.ts:32-35`), then `ensureUser`. A `tilt_` token is not a JWT → rejected; a Privy JWT fails `TOKEN_FORMAT` on mod routes.
- [ ] `requireConsent` (`http.ts:142-155`): identity token verified, same `userId` as access token (`:148`), age ≤ 300 s (`:150`), not > 30 s in the future (`:151`). Relay re-checks (`apps/wallet/src/consent.ts:38-49`) but does not reject a future `iat` (layers disagree; harmless while `iat` is Privy-signed).
- [ ] `issuedAt()` decodes the JWT payload by hand (`privy.ts:18-23`) **after** `verifyIdentityToken` on the same string (`:38-39`). Any copy of this pattern without the verify call is a finding.
- [ ] Sessions listed/revoked only for owner (`sessions.ts:51-72`); admin `session:revoke-user` revokes all (`sessions.ts:74-80`).
- [ ] Mod session never reaches `/v1/account/*` or approve; Privy token never reaches mod routes (exists, `test/auth.test.ts:171`).
- [ ] Sessions per user are uncapped: `createSession` inserts unconditionally (`auth/sessions.ts:23-31`). See H16.

Leads:
- **WA-8 lead (verify): access token accepted as identity token?** Both are ES256 JWTs from `privy.io`, `aud=appId`. If `verifyIdentityToken` in installed `@privy-io/node` accepts an access token, consent degrades to "has an access token". Read `node_modules/@privy-io/node/**/auth*` and test: access token in `x-privy-identity-token` must be 401 (api) and `CONSENT_REQUIRED` (relay).
- **WA-2 / H13 lead (verify): consent is not user interaction and not bound to the intent.** Web mints identity tokens silently (`apps/web/components/privy/useTiltAuth.ts:19-21`). One token authorizes any number of deposits/withdrawals for 300 s, bounded by `money` 6/min. XSS / malicious extension on the web origin → withdrawals (to the player's own wallet only). Residual risk unless a destination can change.
- **Relay trust for the wallet:** `walletOf` caches the relay's `solanaAddress` forever, written only if NULL (`wallets.ts:8-19`, `users.ts:10-15`). A relay answer wrong once binds the user to that wallet for good (loss limit, prize user mapping). Insider lens; relates to open audit item F9.
- `webAuth` inserts a `users` row for every valid Privy token (`users.ts:5-7`): growth only.

## 4. IDOR / BOLA and function-level authorization

- [ ] Every `c.req.param(` is parsed (`IdParam` UUID lowercased, `SignatureParam` base58 64-90, `schemas.ts:170-172`) and every lookup by that id is scoped by `user_id`:
  - intents: `Intents.status` returns null if `row.user_id !== userId` **before** asking the relay (`intents.ts:79-80`); `recordedAction` scoped (`intents.ts:90-95`).
  - sessions: `revokeSession` `WHERE id = $1 AND user_id = $2` (`sessions.ts:66-71`).
- [ ] `userId` always comes from auth context (`c.get("userId")`), never from body or query. All body schemas `.strict()` (`schemas.ts`).
- [ ] Public `/v1/rounds/:sig/verify` and `/v1/leaderboard` return wallet handles / addresses only, never Privy DID or email (`routes/public.ts:36-72,86-103`, `competitions/store.ts:106`).
- [ ] The Privy signer config is integrity-critical (H17): `privySigner` in `GET /v1/account` (`routes/web.ts:75`) comes straight from env `PRIVY_KEY_QUORUM_ID` / `PRIVY_POLICY_ID` (`config.ts:35-36`) and the web grants it on the player's wallet (`DepositPanel.tsx:101-102`, only when `wallet.delegated` is false). Check: does the web pin or allow-list `signerId`/`policyIds`? Does the Privy policy (set by `apps/wallet/scripts/privy-setup.ts`) restrict what that quorum can sign? Cross-ref relay-checklist (signer/policy) and web-checklist (`addSigners`).
- Test: two users A/B, B calls every id-taking route with A's ids → 404 and DB unchanged. Matrix: every route × {none, mod token, Privy access, Privy identity, other-app token, expired, revoked session}.

Lead:
- **H17 lead (verify), insider / supply chain: the api chooses who can sign for player wallets.** Whoever controls the api env or its `/v1/account` response (compromised host, deploy pipeline, MITM between web and api) makes every player who next goes through the deposit flow (and whose wallet is not yet `delegated`) add that attacker's key quorum as signer, bounded only by a policy id the api also supplies. Already-delegated wallets are skipped (`DepositPanel.tsx:99-100`). Treat the two env values as money-critical; decide severity from what the policy allows.

## 5. Intents and idempotency

Path: `routes/mod.ts:51-70` (play), `routes/web.ts:91-117` (deposit/withdraw) → `Intents.submit` (`intents.ts:60-74`) → `record` (`:110-140`) → `forward` to relay (`:153-168`) → `save` (`:170-181`).

Checks:
- [ ] Key = `intent_id` (UUID PK of `intents`, `db.ts:75-87`), lowercased in schema (`schemas.ts:29-32`) and again in `submit` (`intents.ts:66`). Relay also lowercases; program derives its own id. Mixed-case id must map to the same key in all three layers.
- [ ] Replay binding: `find` compares `action = $2::jsonb` (`intents.ts:145`, key-order-insensitive) and `user_id` (`:136`) → `INTENT_CONFLICT`. Relay compares `canonical(action)` and `user_id` (`apps/wallet/src/intents.ts:240-244`).
- [ ] Guarded intents (deposit, play): `pg_advisory_xact_lock(7349202, hashtext(userId))` → insert → guard only if inserted (`intents.ts:123-129`). Guard throw rolls back the insert. Replays skip the guard on purpose.
- [ ] Withdraw has **no guard → plain insert, no lock** (`intents.ts:130`). Per-player serialization is the relay's partial unique index `intents_one_pending_play_per_user` (`apps/wallet/src/db.ts:48-49`, `WHERE status='pending' AND action->>'type' <> 'promo_payout'`). Regression test: N parallel withdraws with distinct ids → 1 executes, N-1 `PLAYER_BUSY` (missing).
- [ ] Deposit replay: `recordedAction` reuses the recorded `open_account|deposit` type; amount mismatch → `INTENT_CONFLICT` (`routes/web.ts:96-99`).
- [ ] `inflight` map (`intents.ts:53,69-73`) is per process, keyed by id only: an optimization, not a lock. Across instances, the relay `claim()` is the idempotency point.
- [ ] Delete-to-retry: on `NOT_RECORDED` (`PLAYER_BUSY`, `BLOCKED`, `FORBIDDEN`, `relay.ts:27`) or `INTENT_CONFLICT`, the api deletes its own pending row (`intents.ts:162-165`). Correct **only if** the relay recorded nothing for each of these codes (cross-zone contract, no shared test). Relay `INTENT_CONFLICT` means the id **is** recorded there (other user/action); deleting the api row is safe only because the api row never executed.
- [ ] Stale delete: `status()` deletes a pending row > 2 min old that the relay does not know (`intents.ts:84-85`, `LOST_AFTER`). A deposit the relay records later then no longer counts toward the api daily deposit limit (H7).
- [ ] **H18** `save()` can regress a terminal status? Its `UPDATE intents SET status = $2 … WHERE intent_id = $1` has no `AND status = 'pending'` guard (`intents.ts:175-179`): a late or stale relay answer (slow `submitIntent` racing a `status()` poll) can overwrite `submitted`/`failed`.
- [ ] Relay `getIntent(intentId)` is unscoped by user (`intents.ts:82`); the api row's `user_id` check (`:80`) is the only owner check. Safe only while api `intent_id` is globally unique across users, including after the delete-to-retry paths (`:85`, `:164`) free an id for someone else.
- [ ] `record` retries once if the row vanished between insert and find (`intents.ts:133-135`), else `PLAYER_BUSY`.
- [ ] Mod cannot send money actions: `PlayActionSchema` union has no `open_account|deposit|withdraw` (`schemas.ts:53-54`).

Leads:
- **H1 / WA-1 lead (verify, needs PoC): prize payout ids can be squatted.** `prizeId = uuidv5(PRIZE_NAMESPACE, "<compId>:<kind>:<rank>")` and the namespace are in the repo (`competitions/uuid.ts:21-26`); the competition id is public on `/v1/leaderboard` (`routes/public.ts:90-91`); `IdParam`/`Uuid` accept any UUID version incl. v5 (`schemas.ts:29-32`); the relay uses **one** `intent_id` namespace for player intents and promo payouts (`apps/wallet/src/app.ts:113-115`). Path to trace: a player sends `POST /v1/play {intentId: prizeId(comp,"rank",1), action:{type:"blackjack_hit"}}` for rank 1..N and drop 1..K before close (60/min). At `prize:pay`, relay `claim()` → `INTENT_CONFLICT` → api `getPromo` filters `promo_payout` (`apps/wallet/src/intents.ts:148-153`) → null → rethrow (`payouts.ts:103-107`) → prize stays `approved` forever; nothing re-issues under a new id. Variant: if `get()` drops the promo filter, the attacker's intent outcome is read as the payout's → prize marked `paid`/`failed` wrongly. Fix ideas: separate namespace at the relay, HMAC-derived prize ids with a server secret, or api refusing non-v4 intent ids.
- Squatting **another player's** id: mod ids come from `crypto.randomUUID()` (`apps/mod/hooks/register.tsx:538`) → nil unless ids leak (§0).

### 5.1 Responsible-gaming limits (enforced only in the api)

- [ ] `planLimit` (`limits.ts:25-35`): stricter now, looser after 24 h; resending the pending value keeps its timer; sending the current value cancels it. Property: no sequence of PUTs loosens the effective limit before `next_at`.
- [ ] `setLimits` inserts the row first, then `FOR UPDATE` (`limits.ts:93-98`): no "lock a missing row" race.
- [ ] `exclude` uses `GREATEST` → `excluded_until` never decreases (`limits.ts:137-143`); `days` bounded 1..3650 (`schemas.ts:166-168`, `limits.ts:135`).
- [ ] Daily deposit = Σ api `intents.amount` of `open_account|deposit`, `status<>'failed'`, 24 h, excluding this id (`limits.ts:181-189`), checked under the advisory lock after insert (`limits.ts:163-166`). Parallel test exists (`test/routes.test.ts:397`).
- [ ] Withdraw never blocked by limits, exclusion or geo (`limits.ts:155-156`, `routes/web.ts:109`).

Leads:
- **H6 / WA-4 lead (verify): daily loss limit fails open.** `dailyLoss` sums indexed `rounds` only (`limits.ts:171-178`): rounds in flight and indexer lag (websocket down, 30 s backfill, H5/H5b) are invisible. Fail-closed option: refuse wagers when `indexed_through` is stale, or read on-chain totals.
- **H7 lead (verify): limits/exclusion exist only in the api.** Relay applies only its own caps. If a player can act without the api (Privy wallet export, signing program ix directly, leaked relay key), limits are bypassed. Check with chain/relay hunters.
- **RG-1 lead (verify): `move` actions blocked by exclusion and geo.** `/v1/play` guards `hit`/`stand`/`reveal`/`cashout`/`climb`/`guess` with `kind:"move"` → exclusion check (`routes/mod.ts:60-67`, `limits.ts:158`), and geoBlock covers all of `/v1/play` (`routes/mod.ts:54`). A player who self-excludes (or travels) mid-round may be unable to cash out. Verify what the program does with an abandoned round before rating.
- Missing concurrency tests: `setLimits` vs deposits; `exclude` racing a pending bet.

## 6. Rate limits

Buckets (`main.ts:36-47`, defaults `config.ts:55-60`): ip 240/min, global 6000/min, token (per session or user) 180/min, auth 10/min, play 60/min, money 6/min, approveAttempts 5 per 600 s. Buckets live in a `Map`, **in memory, per instance, reset on restart** (`ratelimit.ts:1-3,22-58`).

| Check | Where | State @ d559a31 (static read) |
|---|---|---|
| Client IP from XFF only if `TRUST_PROXY`, entry `TRUSTED_PROXY_HOPS` from the **right** | `http.ts:37-45` | `HOPS` too low → a client-written entry is used (spoofable key) |
| HOPS too high, or no XFF reached the api behind the proxy | `http.ts:39-44` | `chain.at(-HOPS)` undefined → socket = **proxy IP** → every such client shares one 240/min bucket (lockout DoS). Tested as intended fallback (`test/http.test.ts:26`). Check vs the real proxy topology |
| Fallback key `"unknown"` | `http.ts:44` | shared bucket only if no socket |
| IPv6 keyed by full address | `http.ts:37-45` | no /64 aggregation: 2^64 buckets per host |
| Per-IP before global | `app.ts:45-54` | a flooder cannot drain global |
| Approve attempts taken before validation | `routes/auth.ts:31` | |
| Money / play / approve keyed on `userId` | `routes/web.ts:87`, `routes/mod.ts:53`, `routes/auth.ts:27` | sybil-multipliable (cheap Privy accounts) |
| Mod routes' `token` bucket keyed on **sessionId** | `routes/mod.ts:41-46` | multiplied by sessions per user (H16) |
| Device poll keyed on IP (`play` bucket) + per-code interval | `routes/auth.ts:18`, `device.ts:62,68` | |
| `/health` unlimited | `app.ts:42-44` | H8 |
| Prune | `ratelimit.ts:49-51,60-65` | O(n) scan on every `take` while > 10k keys; drops only **full** buckets, so long-refill limiters (`approveAttempts`, 600 s) keep keys longer |

Leads:
- **H9 / WA-6 lead (verify): rate-limit identity.** (a) `TRUSTED_PROXY_HOPS` vs prod proxy chain (Vercel / Cloudflare / LB, `docs/dev.md:80`). (b) IPv6 rotation inside a /64. (c) multi-instance multiplies every limit; deploy resets `approveAttempts` and `money`. (d) CPU DoS: keep > 10k partially drained keys (rotating IPs) → every request iterates the whole map. (e) memory: rotating keys on long-refill limiters are retained until refilled.
- **H16 lead (verify): sessions per user uncapped × per-session buckets.** One user can mint sessions through device login (`auth` 10/min per IP; `approveAttempts` refill) with no cap (`auth/sessions.ts:23-31`); each session gets its own 180/min `token` bucket (`routes/mod.ts:41-46`). `/v1/state` is the expensive path: wallet lookup, chain reads, `standings` aggregate (`state.ts:52-58`), relay `getIntent` when an intent is pending (`state.ts:91` → `intents.ts:99-107,82`), and a `saveDetail` write (`state.ts:46`). Test: N sessions of one user, each at its limit; measure DB pool wait / CPU. Fix: per-user bucket on mod routes or a cap on active sessions.
- **H8 lead (verify), DoS: `/health`** is unauthenticated, unlimited, and runs `SELECT 1` on a pool of `max: 20` with 5 s connection timeout (`db.ts:13-19`, `routes/public.ts:76-81`). Flood → pool starvation → every route queues. Intent stated in a comment (`app.ts:42-43`); verify the trade-off still holds; suggest cached result or internal port.
- Expensive public reads with no cost-based limit: `/v1/leaderboard` and `/v1/state` run the full `standings` aggregate per call (`competitions/store.ts:128-148`, `state.ts:52-58`); `/verify` does CPU replay (check multi-draw games, `routes/public.ts:18`).

Tests: spoofed XFF with `TRUST_PROXY` off/on and `HOPS=1` → left entry never used (exists, `test/http.test.ts:13-26`); `clientIp` with `2001:db8::1` vs `::2` (missing); `RateLimiter.take` benchmark with 20k partially drained keys (missing); two `createApp()` instances sharing a DB (missing).

### 6.1 Geo

Mechanism: `geoBlock` (`http.ts:98-102`) → `geoAllowed` (`:92-95`) → `country()` (`:86-90`) reads `COUNTRY_HEADER` (default `x-vercel-ip-country`, `config.ts:43`) **only** when `x-tilt-edge` (`EDGE_HEADER`, `http.ts:56`) matches `EDGE_SECRET`, compared with `timingSafeEqual` over sha256 digests (`:80-83`); value trimmed, uppercased, must be `^[A-Z]{2}$`. `edgeSecret` is null unless `TRUST_PROXY` (`:73`). Unknown country → `GEO_ALLOW_UNKNOWN` (default `false`, fail closed, `config.ts:48`).

- [ ] Every real-money entry point except withdraw has `geoBlock`: approve (`routes/auth.ts:26`), play (`routes/mod.ts:54`), deposit (`routes/web.ts:91`). Not gated: withdraw (by design, §0), `/v1/state`, `/v1/impressions`, device start/poll. A new money route without `geoBlock` is a finding.
- [ ] Prod config: `GEO_ALLOW_UNKNOWN=false`, and `TRUST_PROXY` + `EDGE_SECRET` (≥ 32 chars, `config.ts:46`) set together (`docs/dev.md:80`). `TRUST_PROXY=false` ⇒ country unknown ⇒ blocked unless `GEO_ALLOW_UNKNOWN`.
- [ ] The edge overwrites the country header and strips client-sent `x-tilt-edge` (ops; not in repo: lead).
- [ ] The origin is not reachable without the edge (else the IP key and country come from the attacker; with the secret check, the country is unknown → blocked, which is the safe failure).
- [ ] `COUNTRY_HEADER` matches the header the real edge sets.
- [ ] A leaked `EDGE_SECRET` = full geo bypass (§10.1).
- Invariant **API-G1**: a client-set country header never changes `geoAllowed`. Test: `curl -H 'cf-ipcountry: FR' -H 'x-vercel-ip-country: FR'` without the edge secret → verdict unchanged; with the secret → that country decides. Partly covered (`test/http.test.ts:45`).

## 7. Competitions, drops, prize payouts (the api decides who gets paid)

Lifecycle: `campaign:create` (`competitions/store.ts:177`) → `competition:open` (`store.ts:208-248`) → play, indexer fills `rounds` → `competition:close` (`store.ts:271-315`) → `prize:approve` (`payouts.ts:64-72`) → `prize:pay` (`payouts.ts:129-157`) → relay `POST /payouts/promo` → program.

Checks:
- [ ] Budget: `pool + drop_pool ≤ budget·(1 − commission_bps/1e4) − Σ existing pools`, campaign row `FOR UPDATE` (`store.ts:212-223`). DB: `budget > 0`, `commission_bps 0..10000`, `pool/drop_pool/drop_count ≥ 0`, `tickets_per_hour > 0`, `ends_at > starts_at` (`db.ts:157-186`).
- [ ] Split: integer bps, Σ ≤ 10000, dust stays in pool (`prizes.ts:7-17`); rank prize only if `net > 0` and amount > 0 (`prizes.ts:31-37`).
- [ ] Ranking: net = Σ(payout − stake) over **all** window rounds; eligibility = at least one round with `INITIAL_BET ≥ min_stake` (`store.ts:120-148`). `min_stake` never filters the net.
- [ ] Close: one tx, `FOR UPDATE OF c`, refuses non-open, `ends_at > new Date()` (**app clock**, `store.ts:282`), and `indexed_through < ends_at` unless `--force` (audited `forced:true`, `store.ts:283-289,312`).
- [ ] Prize rows: `id = prizeId(compId, kind, rank)`, `user_id = (SELECT user_id FROM users WHERE solana_address = player)`, `ON CONFLICT (id) DO NOTHING` (`store.ts:298-305`). DB: `amount > 0`, `UNIQUE(competition_id, kind, rank)` (`db.ts:189-206`).
- [ ] Drops: one ticket per eligible round **whatever its stake**, capped `tickets_per_hour` per player per clock hour (`drops.ts:27-36`); winners = lowest `HMAC-SHA256(seed, signature)`, one per player (`drops.ts:38-53`); each drop = `drop_pool / drop_count` (`store.ts:293`).
- [ ] Seed: `randomBytes(32)`, hash published at open (`drops.ts:16-21`); seed returned only when `status='closed'` (`store.ts:74-75`); `/v1/leaderboard` returns it via that mapping (`routes/public.ts:99-100`).
- [ ] Pay: atomic claim `UPDATE … WHERE status='approved' AND (pay_started_at IS NULL OR < now() − 5 min)` (`payouts.ts:82-91`); no `user_id` → `failed` (`:140-144`); `submitted → paid`, `failed → failed`, `pending` or exception → stays `approved` (`:111-126,146-152`); audit per prize (`:154`). Relay idempotent on `payoutId`; program payout-id uniqueness: verify the PDA with chain hunters.
- [ ] Only `approved` is ever sent (`payouts.ts:131-133`).
- [ ] Display text: sponsor, tagline and competition name pass `checkDisplayText` / `UNSAFE_TEXT` (control chars, bidi overrides; `store.ts:166-175`) at creation. A direct DB write bypasses it (insider). See §10.

Leads:
- **H1:** prize-id squatting, full text in §5. PoC: `test/competitions.test.ts` with the api `FakeRelay` (it already shares one id map for intents and promos, `test/helpers.ts:154-159`) or the real relay app in-process.
- **H3 / WA-3 lead (verify, needs simulation): sybil lottery.** Ranking by net gain rewards variance; K accounts on max-variance games (limbo max target, flip `MAX_FLIPS`, tower hard) → P(top-1) grows with K at cost ≈ edge × stake. Drops: ticket per round regardless of stake, `--min-stake` defaults to 0 (`admin.ts:101`), `--tickets-per-hour` 20 (`admin.ts:104`). +EV if `drop_pool / total tickets` > expected loss per min-bet round. Barriers: Privy account uniqueness (no KYC), onboarding fee + min deposit (`routes/web.ts:40-49`), manual review. Monte-Carlo with real payout tables (`apps/api/src/games/*`).
- **H2:** indexer drives prize money (§8). Spec §10.2 "aucun paiement ne se décide sur l'index" vs `db.ts:1-3`.
- **H11 / WA-9 lead (verify), insider / DB write: no pay-time recheck.** `payPrizes` pays `prizes.amount` to `prizes.user_id` as stored; no `Σ prizes ≤ pool` or standings check. A DB write inserting an `approved` row is paid up to relay caps. `prize:approve --competition` bulk-approves all `pending_review` rows (`payouts.ts:64-72`) without showing them.
- **H14 lead (verify): lease vs slow relay.** Lease 5 min (`payouts.ts:26`) > admin relay timeout 30 s (`admin.ts:71`): safe while relay is idempotent. Relay DB restored from backup → a re-run re-sends; on-chain payout-id uniqueness is the only backstop. A squatted (H1) prize is re-claimed every 5 min forever.
- **WA-10 lead (verify): drop seed stored in plaintext in the api DB** (`db.ts:180`). DB read before close → know every ticket's score → grind (keep playing min-stake rounds until a signature scores below the current best) or tip someone. Option: keep only the hash until close.
- Campaign lookup `id::text = $1 OR sponsor = $1` (`store.ts:213`): a sponsor named like another campaign's UUID makes `rows[0]` ambiguous.
- Close uses app clock (`store.ts:282`) and live-indexed rounds carry api receive time as `settled_at` (`indexer.ts:287`): boundary snipes.
- **H12 lead (verify), sponsor fraud: impressions are client-reported.** Any session can POST 60 s per minute for the running sponsor (`routes/mod.ts:79-90`), capped per user-minute (`LEAST(60, …)`, DB CHECK 0..60 `db.ts:213`). Sybils inflate the sponsor report. Never tie money to impressions.

Tests to demand: Σ prizes ≤ pools ≤ budget after commission (fast-check); tampered `prizes` row → `prize:pay` refuses (after fix); randomized interleavings of `payPrizes` with relay timeouts/pending → each prize paid once; bulk approve after a late insert; sybil EV simulation.

## 8. Indexer trust (rollup RPC → `rounds` → limits, leaderboard, prizes, /verify)

Trusted outputs of `rounds`: daily loss limit, leaderboard, **prizes**, drop tickets, `/verify`. Source: one `ROLLUP_RPC_URL` / `ROLLUP_WS_URL` at `confirmed` (`indexer.ts:176-197`).

Checks:
- [ ] Events decoded only from `Program data:` lines while the top of the invoke stack is `PROGRAM_ID` (`indexer.ts:91-101`, regexes `:37-38`). Check "Log truncated" behaviour of the MagicBlock validator (truncation could desync the stack or drop events).
- [ ] Draws only from instructions with `programId == PROGRAM_ID` and name in `CALLBACKS` (`indexer.ts:27-34,134-144`).
- [ ] Failed txs skipped: live `if (!l.err)` (`:180`), listing `failed` flag (`:189`), fetch `!tx || meta.err → null` (`:197`).
- [ ] Idempotent writes: `rounds` PK `signature` + `UNIQUE(player, round)` (`db.ts:92-106`), `saveRound`/`saveDraw` `ON CONFLICT DO NOTHING` (`rounds.ts:41-64`); `detail` written once, only when `(player, round, request_id)` match (`rounds.ts:71-83`).
- [ ] `indexed_through` monotonic (`GREATEST`, `indexer.ts:303-317`) and should mean "every round settled before T is indexed".
- [ ] A null fetch for a **non-failed** signature stops the run instead of advancing (today it does not: H5b).

Leads:
- **H5 lead (verify, needs PoC): backfill truncation still marks completeness.** `newSignatures` stops after `MAX_PAGES · PAGE` = 50,000 signatures, keeps the **newest**, logs a warning (`indexer.ts:40-42,320-332`); `catchUp` processes them then sets `indexed_through = startedAt − 10 s` (`:336-345`). Older signatures between the old cursor and that window are never indexed, yet `closeCompetition`'s gate passes (`store.ts:283-289`) → wrong winners; `dailyLoss` under-counts. Triggers: api down for a while; or an attacker flooding cheap failed txs that mention `PROGRAM_ID` (failed txs are listed) — lead (verify ER behaviour: does the MagicBlock ER accept and list arbitrary failed txs, at what cost?). PoC: fake `RollupSource` returning > 50k signatures.
- **H5b lead (verify): null `getTransaction` → cursor advances → round lost.** In `catchUp` (`indexer.ts:338-343`), when `source.transaction()` returns null for a non-failed signature (`ConnectionSource.transaction` returns null on `!tx`, `:197`: confirmed-but-not-yet-fetchable, RPC pruning or lag), the round is not processed but `advance()` still moves the cursor past it, and `indexedThrough` (`:344`) then passes it. If the websocket also missed that tx, the round is gone for good: wrong prizes, under-counted `dailyLoss`, close gate passes. Cheaper trigger than H5. PoC: fake `RollupSource` whose `transaction()` returns null once for a settling signature, websocket feed off; after `catchUp`, round missing and `indexed_through` past it. Fix direction: stop the run on a null for a non-failed signature.
- **H2 lead (verify): trust in `confirmed` + single RPC.** A compromised/misconfigured RPC or a rollup rollback of confirmed-not-committed txs leaves phantom winning rounds; nothing cross-checks `rounds` against base-layer state or the account's round counter. Live rounds get `settled_at = new Date()` (`indexer.ts:287`), backfill uses `blockTime` (`:341`); first writer wins. Fix direction: reconcile prize winners against on-chain totals or a second RPC before approval.
- Amplification: `CALLBACK_LOGS` matching is on plain `Program log: Instruction: …` text anywhere in the logs (`indexer.ts:19-26,253`), so any program can force extra `getTransaction` calls. RPC cost only.

### 8.1 Hidden-state reads (highest payoff: early knowledge of an outcome = +EV)

`draws` stores every VRF callback per player account (`db.ts` "Every VRF callback" table); `/verify` (`routes/public.ts:24-34,105`) and `/v1/state` (`state.ts:35-50`, `games/view.ts` `buildRoundView`) serve round data.

- [ ] No route serves draws, outcome or detail of an **unsettled** round: `/verify` only accepts signatures found in `rounds` (`findRound`, `rounds.ts:113-116`, settled rounds only), and `drawsBetween` is bounded above by that settled round's `requestId` (`routes/public.ts:27-31`, `rounds.ts:137`).
- [ ] `buildState` / `buildRoundView` expose only what the program account already shows for an in-progress round (mines tiles, tower path, hilo card, blackjack hole card). Cross-check with sec-chain-rng on what the on-chain account and VRF callback logs reveal (if the program reveals it, the api is not the bug).
- [ ] `/v1/leaderboard`, error messages and intent outcomes carry no draw of a running round.
- Invariant **API-X3**: no api response reveals randomness or outcome of a round before it settles. Test: start a mines round, take N draws (reveals), then call `/v1/state` and `/verify` for every indexed signature of that player; assert no unrevealed tile position or future draw appears.

## 9. Admin CLI (`admin.ts`)

| Check | Where | State |
|---|---|---|
| Operator identity | `admin.ts:135-138` | `ADMIN_ACTOR` free text; auth = possession of `DATABASE_URL` |
| Audit log append-only | `db.ts:230-237` | by convention only: same DB role can UPDATE/DELETE, no trigger/REVOKE |
| Amounts | `units()` `admin.ts:54-57` | `^\d{1,20}$` → BigInt; `0` accepted for `--pool` (DB CHECK `pool >= 0`), `--budget 0` refused by DB CHECK |
| Integers | `int()` `admin.ts:59-63` | `Number()` + safe-integer + ≥ 0: `"1e3"` → 1000, `" 7 "` → 7, `""` → 0 for optional flags; required flags reject empty (`required()` `:48-52`); `--hours 0` refused by DB `ends_at > starts_at` |
| Split | `admin.ts:99`, `prizes.ts:7-17` | Σ bps ≤ 10000 enforced |
| `--status` | `admin.ts:113-114` | allow-listed |
| `--force` close | `admin.ts:109-111` | warns + audited, no second person |
| Bulk approve | `admin.ts:117-118` → `payouts.ts:64-72` | approves every `pending_review` row of a competition |
| Relay creds | `admin.ts:67-72` | `RELAY_URL` + `RELAY_API_KEY` in the operator's env |
| Migrations | `db.ts:243-252` | **every command, read-only ones like `prize:list` included, runs `migrate()`**: DDL plus `UPDATE rounds …` data migrations (`db.ts:111-138`) against whatever `DATABASE_URL` is set |

Risk framing (insider lens): DB write = mint promo payouts up to relay caps (H11). Leaked `RELAY_API_KEY` alone = call `/payouts/promo` for any user with **no consent** (consent covers only `open_account|deposit|withdraw`), bounded by `MAX_PROMO_PAYOUT`/`DAILY_PROMO_LIMIT`. Spec §10.7 asks for nominative accounts + 2FA; there is no 4-eyes rule. Missing tests: CLI argument parsing (`int`, `units`, `--split`), overlapping competitions.

## 10. Logging, secrets, served strings

- [ ] Request log uses `routePath`, never the URL (`app.ts:21-31`): no device codes, intent ids or tokens in access logs.
- [ ] `log.error` serializes only `e.message` (`log.ts:5,14-18`). `pg` error messages can embed input values and are logged on any unhandled 500 (`app.ts:71`).
- [ ] `log` callers never pass tokens/codes (comment `log.ts:1`): grep every `log.(info|warn|error)` payload for `token`, `authorization`, `identityToken`, `deviceCode`, `email`, `body`.
- [ ] Relay refusal logged with code only (`relay.ts:64-65`). Prize pay failure logs `e.message` + prize id (`payouts.ts:149`).
- [ ] Mod never sends prompts/code (CLAUDE.md); impressions carry only `sponsor` + `seconds` (`schemas.ts:148-150`).
- [ ] Every string served to the mod terminal or the web is derived (base58, handles, numbers, ISO dates, fixed vocabulary) or filtered by `UNSAFE_TEXT`:
  - sponsor name / tagline / competition name: `checkDisplayText` at creation only (`competitions/store.ts:166-175`), served by `sponsorView` (`store.ts:98-103`) in `/v1/state` and `/v1/leaderboard`. A direct DB write skips the filter (insider).
  - intent errors: `safeIntentError` keeps a relay `PROGRAM_ERROR` message only if it matches `^[A-Z][A-Za-z0-9]{0,63}$` (`relay.ts:29,42-49`), else fixed text; stored in `intents.error_message` and served by `/v1/intents/:id`.
  - prize errors: `prizes.error` also goes through `safeIntentError` (`payouts.ts:120-123`) and no route serves it at d559a31 (admin `prize:list` prints it to the operator terminal).
  - Impact of a control/ANSI/bidi char in the terminal: mod-checklist (terminal injection).
- Test: run the suite with a spy on `console.*`; assert no `/eyJ[\w-]+\.eyJ/` (JWT), `/tilt_[\w-]{43}/`, or 43-char device code appears.

### 10.1 Secrets inventory (insider lens; storage and rotation: supply-chain-ops-checklist)

| Secret | Read at | If leaked | Second barrier |
|---|---|---|---|
| `RELAY_API_KEY` | `config.ts:27`, `main.ts:24`, `admin.ts:69` | promo payouts for any user, no consent; rounds as any user (no consent for play) | relay caps `MAX_PROMO_PAYOUT` / `DAILY_PROMO_LIMIT`; relay network isolation (unverifiable from repo) |
| `DATABASE_URL` | `main.ts:21`, `admin.ts:135` | DB write → insert `approved` prizes (H11), edit limits/exclusions, read drop seeds (WA-10), rewrite audit log | relay caps only; no pay-time recheck |
| `EDGE_SECRET` | `config.ts:46`, `http.ts:73` | forged country → full geo bypass (§6.1) | none in the api |
| `PRIVY_APP_SECRET` | `config.ts:33`, `main.ts:34` → `privy.ts:29` | whatever the Privy server API allows with app credentials (check: user data, wallets) | Privy dashboard settings |
| `PRIVY_KEY_QUORUM_ID` / `PRIVY_POLICY_ID` | `config.ts:35-36`, `routes/web.ts:75` | not secret; **integrity**: changing them redirects signer grants (H17) | Privy policy content |

- Lead G-A6 (verify): `verifyAccessToken` / `verifyIdentityToken` may work with only the app id + JWKS / verification key; if so, the api need not hold `PRIVY_APP_SECRET` at all.

## 11. Error responses

- [ ] `onError`: `ApiError` → its status and own message; anything else → generic `INTERNAL_ERROR` 500 (`app.ts:69-74`, `errors.ts:5-36`).
- [ ] zod failures reduced to field names (`http.ts:18-26`); `parseParam` → `invalid <name>` (`http.ts:28-32`).
- [ ] Relay errors mapped to a fixed vocabulary (`relay.ts:29-67`); Anchor error names allow-listed by regex (`relay.ts:29,44-46`); relay 400/401/5xx → `UPSTREAM_ERROR` (`:50,64-66`).
- [ ] Device approve: one 404 for unknown/expired/used (`routes/auth.ts:35-37`); intents: 404 for another user's id (`intents.ts:80`).
- Test: force a pg error → body exactly `{"error":{"code":"INTERNAL_ERROR","message":"internal error"}}`.

## 12. SQL

- [ ] All statements parameterized (`$n`). Interpolated fragments must be compile-time constants. Known at d559a31: `LIMITS_COLUMNS` (`limits.ts:47-48,78,96,117`), `INITIAL_BET` with `MOST_BETS_PER_DEALT_HAND` (`competitions/store.ts:114-123,138,253`), `SELECT_COMPETITION` (`store.ts:54-57`), column choice `id`/`competition_id` (`payouts.ts:67`), `${U64}` type in DDL (`db.ts:38`). Any `${…}` built from request data is a finding.
- [ ] Every advisory lock is `pg_advisory_xact_lock` inside `transaction()` on the same client (`intents.ts:123-125`), except the migration lock, session-level and unlocked in `finally` (`db.ts:243-251`).
- [ ] Conditional writes check `rowCount` (`device.ts:89`, `sessions.ts:71`, `intents.ts:127,131`); `claim()` uses `RETURNING` (`payouts.ts:83-90`). Unconditional status write: `Intents.save` (§5).
- [ ] Pool hygiene: `max 20`, `connectionTimeoutMillis 5000`, `statement_timeout 10000` (`db.ts:10-19`). No transaction spans a network call at d559a31 (the advisory lock covers insert + guard only, not the relay call): re-check.
- [ ] DB constraints back the invariants: status enums, `scope='play'`, `amount > 0` on prizes, impression seconds 0..60, `UNIQUE(competition_id,kind,rank)`. `intents.amount` is `NUMERIC(20,0)` without `> 0` CHECK (`db.ts:80`); positivity relies on zod `Amount`.

## 13. zod and amount parsing

- [ ] Amounts: `Amount = /^[1-9]\d{0,19}$/` + refine `≤ 2^64−1`, guarded so `BigInt` never sees bad input (`packages/contract/src/relay.ts:7-11`). Rejects `0`, `-1`, `01`, `1.0`, `1e6`, ` 1`, `+1`, full-width digits (JS `\d` is ASCII). Leading-zero rejection matters: two encodings of one value would break replay equality.
- [ ] Arithmetic on amounts uses `BigInt` (`routes/web.ts:44-48`, `limits.ts:161,165`) or Postgres `numeric` sums; grep for `Number(`, `parseFloat`, `z.number()` or `z.coerce` on any amount.
- [ ] Every body schema `.strict()` (`schemas.ts:35-168`), including **each** `discriminatedUnion` member.
- [ ] Numeric game params are bounded integers: most are `z.number().int().min().max()` (hands, tiles, mines, flips, chips, days); `wheel_spin.segments` is `z.number().refine(includes WHEEL_SEGMENTS)` without `.int()` (`schemas.ts:103-107`, safe: membership in an integer list); `dice_roll.target` is `.int()` bounded only through `superRefine` win-chance (`:84,134-138`). A bare `z.number()` would accept `1e21`, floats, > 2^53.
- [ ] Ids: `Uuid` = `.uuid()` + lowercase transform (`schemas.ts:29-32`). Accepts **any** version (incl. v5 prize ids: H1).
- [ ] `parseBody` ignores `Content-Type` and uses `c.req.json()` (`http.ts:18-19`): fine with bearer auth; CSRF-relevant if Privy cookies are ever enabled (WA-12, latent).
- [ ] Config fail-closed defaults: `GEO_ALLOW_UNKNOWN=false`, `TRUST_PROXY=false` (`config.ts:48-50`); `RELAY_API_KEY` ≥ 32 chars, `EDGE_SECRET` ≥ 32 (`config.ts:27,46`). Config uses `z.coerce.number()` for ints (`config.ts:15`): operator input.
- [ ] Relay contract schemas (`IntentRequest`, `PromoPayoutRequest`, `packages/contract/src/relay.ts`) are plain `z.object` (strip unknown keys before `canonical()`). Unsafe if anyone adds `.passthrough()`. Shared zone: both owners.
- Test: one fixture of malformed amounts through api schema, relay schema and web parser: `"0","00","01","-1","1.0","1e6"," 1","1 ","+1","１","18446744073709551615","18446744073709551616","99999999999999999999"`; body with `__proto__` / unknown key → 400 and `({}).polluted === undefined`.

## 14. Lead register (start here for attacker-goal / red-team)

Severity guesses are single `severity.md` enum values with the condition that changes them; re-rate from the code. "Seen @ d559a31": `static read` = traced in code once, still needs re-trace at HEAD; `design note` = behaviour by design, question is whether it is acceptable; `needs PoC` = not decidable statically.

| Id | Lead | Pointers | Sev. guess | Seen @ d559a31 |
|---|---|---|---|---|
| H1 | Prize-id squatting blocks every promo payout of a competition (§5) | `competitions/uuid.ts:21-26`, `routes/public.ts:90-91`, `schemas.ts:29-32`, `apps/wallet/src/app.ts:113-115`, `apps/wallet/src/intents.ts:148-153`, `payouts.ts:103-107` | High | static read, needs PoC |
| H17 | api env/response chooses the Privy signer + policy granted on player wallets (§4) | `routes/web.ts:75`, `config.ts:35-36`, `DepositPanel.tsx:101-102` | High if the policy allows transfers out, else Low (insider) | static read |
| H3 | Sybil lottery on net-gain ranking; drops +EV with `min-stake 0` | `store.ts:128-148`, `drops.ts:27-53`, `admin.ts:101,104` | Medium (High if drop EV per ticket > edge × min stake) | needs PoC (simulation) |
| H2 | Prize winners decided from `confirmed` index of one RPC | `indexer.ts:176-197,287`, `store.ts:250-305` | Medium (High if a rollback or forged round is reachable below A5) | design note |
| H5 | Backfill truncation still advances `indexed_through` | `indexer.ts:320-345`, `store.ts:283-289` | Medium | static read, needs PoC |
| H5b | Null `getTransaction` for a non-failed sig → cursor and `indexed_through` advance, round lost | `indexer.ts:197,338-344` | Medium | static read, needs PoC |
| HS-1 | Hidden state of an unsettled round served by `/verify` or `/v1/state` (§8.1) | `routes/public.ts:24-34`, `rounds.ts:113-137`, `state.ts:35-50` | High if any unsettled draw is served; else no finding | not traced |
| H11 | No pay-time recheck; mutable audit log; self-declared actor; bulk approve | `payouts.ts:64-72,129-157`, `admin.ts:135-138`, `db.ts:230-237` | Medium (insider) | static read |
| H6 | Daily loss limit fails open on lag / in-flight bets | `limits.ts:159-178` | Medium | static read |
| H7 | Limits/exclusion only in the api; stale-row delete un-counts deposits | `limits.ts:181-189`, `intents.ts:84-85` | Medium | lead (verify) |
| H4 | Device-code phishing → 30-day play session on victim | `auth/device.ts:21-46`, `sessions.ts:7` | Medium | design note |
| H8 | `/health` unlimited DB hit → pool starvation | `app.ts:42-44`, `routes/public.ts:76-81`, `db.ts:13-19` | Medium | static read, needs PoC |
| H9 | XFF hops, shared proxy bucket, IPv6 /64, per-instance buckets, O(n) prune, key retention | `http.ts:37-45`, `ratelimit.ts:49-65` | Medium | static read |
| H16 | Sessions per user uncapped × per-session `token` bucket on `/v1/state` | `routes/mod.ts:41-46`, `auth/sessions.ts:23-31`, `state.ts:46,52-58` | Low (Medium if pool saturation is shown) | static read, needs PoC |
| WA-2 | Consent = silent token refresh, not bound to intent | `http.ts:142-155`, `apps/web/components/privy/useTiltAuth.ts:19-21` | Medium | design note |
| WA-8 | Access token accepted as identity token? | `privy.ts:32-40` | needs-poc (Medium if accepted) | needs PoC |
| H18 | `Intents.save` overwrites a terminal status (no `status='pending'` guard) | `intents.ts:175-179` | Low (Medium if it un-fails a counted deposit or hides a failure) | static read |
| RG-1 | Exclusion/geo block cash-out moves mid-round | `routes/mod.ts:54,60-67`, `limits.ts:158` | Low (Medium if the program never refunds an abandoned round) | lead (verify program) |
| WA-10 | Drop seed plaintext in api DB before close | `db.ts:180`, `store.ts:74-75` | Low (Medium if DB read is reachable below A5) | static read |
| H10 | Unauth device start = insert + unindexed DELETE sweep | `device.ts:22`, `db.ts:48-58` | Low | static read |
| H12 | Impression inflation by sessions/sybils | `routes/mod.ts:79-90` | Low | static read |
| H14 | Pay lease vs relay restore → re-send | `payouts.ts:26,82-91`, `admin.ts:71` | Low | design note |
| H15 | Smaller items: app-clock close; api-time `settled_at`; standings per poll; pg messages in logs; each `/v1/state` poll with a pending intent calls relay `getIntent` (relay amplification) | `store.ts:282`, `indexer.ts:287`, `state.ts:58,91`, `intents.ts:82,99-107`, `app.ts:71` | Low | static read |

Cross-layer chains worth trying: H1 + H3 (freeze rivals' prizes while farming drops); H4 + H3 (phished sessions as extra leaderboard entries: prizes still go to the victim's wallet, so look for any path that redirects a prize); H5/H5b + H2 (truncate or starve backfill before a close); leaked `RELAY_API_KEY` + H11 (promo drain up to `DAILY_PROMO_LIMIT` per day); api env control + H17 (signer on new depositors).

## 15. API invariants (for invariant-breaker)

The INV column names the matching row of `invariants.md`; cite it in findings.

| Id | INV | Invariant | Enforced at | Test |
|---|---|---|---|---|
| API-A1 | INV-45 | A mod token authenticates only if its sha256 exists, `scope='play'`, not revoked, not expired; never on `/v1/account/*` or approve | `sessions.ts:34-49`, `db.ts:65` | exists (`test/auth.test.ts:149-171`) |
| API-A2 | INV-45 | A device code yields at most one session; an approved-but-expired code yields none | `device.ts:59-76` | expiry exists (`auth.test.ts:78`); parallel polls missing |
| API-A3 | INV-45 | A user code is approved at most once | `device.ts:84-89` | exists (`auth.test.ts:109`) |
| API-A4 | INV-50 | Approve attempts per user ≤ 5 + refill/10 min, even in parallel (per instance) | `routes/auth.ts:31` | exists (`auth.test.ts:103`) |
| API-A5 | INV-45 | Consent token user == access token user, age in [−30 s, 300 s] | `http.ts:148-153` | partial |
| API-G1 | INV-49 | A client-set country header never changes `geoAllowed` (§6.1) | `http.ts:73-95` | partial (`test/http.test.ts:45`) |
| API-I1 | INV-47 | An intent id (lowercased) is bound forever to one `(user_id, action)` at api **and** relay | `intents.ts:136-138`, `apps/wallet/src/intents.ts:240-244` | property test missing |
| API-I2 | INV-46 | No `/v1/play` input makes the relay receive a money action | `schemas.ts:53-54` | exists (malformed/money actions) |
| API-I3 | INV-47 | The api deletes a pending row only when the relay recorded nothing for it | `intents.ts:84-85,162-165`, `relay.ts:27` | cross-zone contract test missing |
| API-I4 | INV-48 | Payout ids and player intent ids never collide | none found | suspected violated (H1) |
| API-I5 | INV-47 | An intent's terminal status never changes | `intents.ts:175-179` (no guard) | missing |
| API-L1 | INV-49 | No PUT sequence loosens a limit before 24 h | `limits.ts:25-35,90-131` | property missing |
| API-L2 | INV-49 | `excluded_until` never decreases | `limits.ts:137-143` | |
| API-L3 | INV-49 | Σ accepted deposits (non-failed, 24 h) ≤ `daily_deposit` under concurrency | `intents.ts:123-129`, `limits.ts:163-166` | exists (`test/routes.test.ts:397`) |
| API-L4 | INV-49 | Withdrawals never blocked by limits, exclusion or geo | `limits.ts:155-156`, `routes/web.ts:109-117` | |
| API-R1 | INV-50 | Tokens taken ≤ capacity + elapsed·refill | `ratelimit.ts:37-58` | `test/units.test.ts` |
| API-R2 | INV-50 | Client IP is never an XFF entry left of `−TRUSTED_PROXY_HOPS` | `http.ts:37-45` | exists (`test/http.test.ts:13-26`) |
| API-X1 | INV-52 | Re-processing a signature never double-counts a round | `rounds.ts:41-64`, `db.ts:92-106` | `test/indexer.test.ts` |
| API-X2 | INV-52 | `indexed_through = T` ⇒ every round settled before T is indexed | `indexer.ts:336-345` | suspected violated (H5, H5b) |
| API-X3 | — (with sec-chain-rng) | No api response reveals randomness or outcome of an unsettled round (§8.1) | `routes/public.ts:24-34`, `state.ts:35-50` | missing |
| API-C1 | INV-51 | Σ(pool + drop_pool) per campaign ≤ budget·(1 − commission) | `store.ts:212-223` | `test/competitions.test.ts` |
| API-C2 | INV-51 | Σ rank prizes ≤ pool; Σ drop prizes ≤ drop_pool; each > 0, **also at pay time** | `prizes.ts:7-37`, `db.ts:196` | pay-time check missing (H11) |
| API-C3 | INV-51 | Each prize paid at most once across concurrent/crashed runs | `payouts.ts:82-91` + relay + program | `test/competitions.test.ts` |
| API-C4 | INV-51 | Only `approved` prizes are ever sent | `payouts.ts:131-133,85` | |
| API-C5 | INV-51 | Drop seed never served before close; `sha256(seed) == drop_seed_hash` | `store.ts:74-75`, `drops.ts:16-21` | |
| API-C6 | INV-51 | A competition closes once, not before `ends_at`, not before the indexer caught up unless forced and audited | `store.ts:278-289,312` | exists |
| API-M1 | — | Every SQL statement parameterized; interpolations are constants | §12 | grep in CI suggested |
| API-M2 | INV-53 | No player-facing error carries relay/upstream/pg text | `relay.ts:42-67`, `app.ts:69-74` | partial |

## 16. Grep pack (repo root)

```sh
# route wiring and auth coverage
rg -n "app\.(get|post|put|delete|use|all|on)\(" apps/api/src
rg -n "c\.req\.(param|query|header)\(" apps/api/src
# reads followed by dependent writes; locks; in-memory guards
rg -n "SELECT .* FROM " apps/api/src | rg -v "FOR UPDATE"
rg -n "pg_advisory|FOR UPDATE|SERIALIZABLE|40001|rowCount|RETURNING" apps/api/src
rg -n "UPDATE \w+ SET status" apps/api/src
rg -n "new (Map|Set)<" apps/api/src
# idempotency and ids
rg -n "ON CONFLICT|intent_id|payoutId|uuidv5|prizeId|toLowerCase\(\)" apps/api/src apps/wallet/src packages/contract/src
# SQL interpolation (template literal with ${} inside query)
rg -n 'query(<[^>]*>)?\(\s*`[^`]*\$\{' apps/api/src
# parsing
rg -n "z\.coerce|z\.number\(\)|parseFloat|Number\(|\.passthrough\(\)|z\.any\(\)|z\.unknown\(\)" apps/api/src packages/contract/src
rg -n "z\.object\(" apps/api/src/schemas.ts | rg -v strict
# IP, limits, geo
rg -n "x-forwarded-for|clientIp|remoteAddress|rateLimit\(|limiters\.|geoBlock|EDGE_HEADER" apps/api/src
# served strings, logging of sensitive values
rg -n "checkDisplayText|UNSAFE_TEXT|safeIntentError|sponsorView" apps/api/src
rg -n "log\.(info|warn|error)\(|console\." apps/api/src | rg -i "token|secret|authorization|email|body|code"
# JWT handling, signer config
rg -n "verifyAccessToken|verifyIdentityToken|split\(\"\.\"\)|base64url|PRIVY_KEY_QUORUM_ID|PRIVY_POLICY_ID" apps/api/src apps/web/app
```

## 17. Running things and PoC harness (local stack only)

Generic commands, worktree setup, race-widening and harness doubles: `poc-recipes.md`. Only the api-specific traps are here.

**Before running anything** (SKILL.md rule 1: local stack; devnet read-only; mainnet never):
- [ ] Echo, without printing values that are secrets, the **host part** of `DATABASE_URL`, `TEST_DATABASE_URL`, `API_DATABASE_URL`, `RELAY_DATABASE_URL`, `RELAY_URL`, `BASE_RPC`, `ER_RPC`, `ER_WS`, `SOLANA_RPC_URL`, `ROLLUP_RPC_URL`, `ROLLUP_WS_URL`; each must be `127.0.0.1` / `localhost` or unset. E.g. `for v in DATABASE_URL TEST_DATABASE_URL RELAY_URL BASE_RPC ER_RPC ER_WS SOLANA_RPC_URL ROLLUP_RPC_URL ROLLUP_WS_URL API_DATABASE_URL RELAY_DATABASE_URL; do printf '%s=%s\n' "$v" "$(printenv $v | sed -E 's#^[a-z+]+://([^@/]*@)?([^/:]*).*#\2#')"; done`.
- [ ] Never run any `pnpm --filter @tilt/api admin …` command, read-only ones included, against a non-local `DATABASE_URL`: every command runs `migrate()` (DDL + data `UPDATE`s, §9).
- [ ] e2e (`pnpm --filter @tilt/api e2e`, `test/stack.e2e.ts`) defaults to 127.0.0.1 but honours `BASE_RPC` / `ER_RPC` / `ER_WS` / `API_DATABASE_URL` / `RELAY_DATABASE_URL` from the env (`test/stack.e2e.ts:7-8,73-75,170,199`) and signs with `ANCHOR_WALLET` (admin, mint authority). Run it with those variables explicitly unset (`env -u BASE_RPC -u ER_RPC -u ER_WS -u API_DATABASE_URL -u RELAY_DATABASE_URL …`) or set to local values.
- [ ] `pnpm --filter @tilt/api start` loads the local env (never read its values): if `RELAY_URL` points at a devnet relay, a `/v1/play` probe writes there. Check the host first.

api-specific traps:
- **Silent skip:** `testDb()` returns null and DB suites skip with a warning when Postgres is unreachable (`test/helpers.ts:28-40`). A green run may mean nothing ran; read the output. CI provides Postgres (`.github/workflows/api.yml`).
- **FakeRelay shares one id map** for player intents and promo payouts (`test/helpers.ts:154-159`), like the real relay: good for H1, but a fix tested only against FakeRelay proves nothing about `apps/wallet`; also run against the real relay app in-process or e2e.
- No coverage block in `apps/api/vitest.config.ts`: spec §11.2 (≥ 90 % on money code) is unmeasured.
- Races: `Promise.all` of N `app.request` calls on `testApp(db, new FakeRelay(), new FakeChain(), overrides)` (`test/helpers.ts:259-280`), then assert the **DB invariant**, not just status codes. `fast-check` is already a devDependency (`apps/api/package.json`).

PoC sketches (write in a worktree, keep as regression tests):
- H1: competition with FakeRelay; as player X `/v1/play` with `prizeId(compId,"rank",1)`; close, approve, `payPrizes` → expect paid; suspected outcome: stays `approved` forever.
- H5 / H5b: fake `RollupSource` (> 50k signatures, or one null `transaction()` for a settling signature, websocket off); after `catchUp`, `indexed_through` passes a missing round.
- H18: relay answer `failed` arrives after `status()` already saved `submitted` (delay `submitIntent`, poll `/v1/intents/:id` meanwhile) → final row status.
- H16: 20 sessions for one user, each at 180/min on `/v1/state` → pool wait time vs 1 session.
- HS-1: mines round mid-play → `/v1/state` + `/verify` on every indexed signature of that player → no unrevealed tile.
- Route matrix (§1.2): loop over `app.routes` × {no bearer, Privy access on mod paths, `tilt_` token on web paths} × path variants → 401 everywhere non-public.
- API-G1: `/v1/geo` and `/v1/play` with a client-set country header, with and without `x-tilt-edge` (`EDGE` header builder in `test/helpers.ts`).
- H11: insert an `approved` prize above the pool and run `payPrizes` → must refuse (after fix).
