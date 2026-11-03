# CLAUDE.md

Act like a pragmatic senior engineer. Write code a strong teammate would approve quickly: correct, simple, readable, and no larger than the task needs.

## Project

- **Name:** Tilt
- **What:** A crypto casino on Solana, played inside Claude Code (a Claude Code mod) while the agent works, with a sponsor always visible. Spec: `docs/spec.md` (source of truth). Background: `docs/idea.md`, `docs/integrations.md`.
- **Status:** Spec draft v0.1, pending validation. Armand's zone is implemented and running on devnet: `chain/` (Anchor program + MagicBlock rollup, see `chain/README.md`), `apps/wallet` (relay), `packages/contract`; ops in `docs/runbook.md`. Eli's zone is implemented: `apps/api`, `apps/mod` (Claude Code mod), `apps/web`; how to run everything locally: `docs/dev.md`. Open decisions are listed in the spec (§13); don't settle them in code. Ask instead.
- **Team:** Eli and Armand, each working with their own AI.
- **Ownership:** Stay inside the zone you're working for (spec §8). Never edit the other person's zone; open an issue or ask.
  - **Armand:** everything that touches money or game rules: `chain/` (Anchor program: games, VRF, bankroll) and `apps/wallet` (relay: Privy, signers, fee payer, transaction sending).
  - **Eli:** `apps/mod` (Claude Code mod, displays on-chain state), `apps/api` (mod sessions, reads program events, competitions, sponsors) and `apps/web`.
  - `packages/play` and `harnesses/` are client-side like `apps/mod` and need Eli's review.
  - **Shared:** `packages/contract` (program IDL + relay API), the only boundary between the two zones. Changes need both to agree.
- **Stack:** pnpm monorepo, TypeScript (Node 22, Hono, Postgres, Next.js, Privy) and Rust/Anchor for `chain/`. Spec D7 still to confirm formally.
- **Design:** the Tilt design system is the project skill `.claude/skills/tilt-design/` (brand, tokens, components); use it for any UI.
- **Repo:** Private GitHub repo `ebenbaruk/Tilt`. It must stay **private**. Never make it public or publish this code anywhere else.

## Commands

pnpm monorepo (pnpm 12.3.4, Node 22+). Full local setup (Postgres, Solana + MagicBlock rollup + VRF): `docs/dev.md`.

```sh
scripts/ci.sh            # the whole CI, locally (no GitHub CI); --e2e adds the stack end-to-end tests
pnpm install --frozen-lockfile
pnpm -r typecheck && pnpm lint && pnpm format:check   # lint/format cover apps/api, apps/mod, apps/web only
pnpm --filter @tilt/contract test
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_api_test pnpm --filter @tilt/api test
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet test
pnpm --filter @tilt/web test && pnpm --filter @tilt/web e2e
(cd apps/mod && claude plugin validate . && claude plugin test .)   # runs every test file; no single-file filter
(cd chain && cargo +1.89.0 test)
```

- Single vitest test (no `--` before the arguments): `pnpm --filter @tilt/api test test/routes.test.ts -t "part of the name"`.
- The api and wallet tests need the `tilt-pg` Postgres container (docs/dev.md §1). Each suite resets its own tables; don't share one database between branches.
- `pnpm --filter @tilt/mod typecheck` skips until the mod has loaded once in Claude Code (`claude --plugin-dir apps/mod`), which writes the engine types to `apps/mod/.claude-plugin/types/` (git-ignored).
- Try the mod without touching your settings: `claude --plugin-dir apps/mod --settings '{"tui":"default","pluginConfigs":{"tilt":{"options":{"apiUrl":"http://127.0.0.1:8080"}}}}'`.

## Architecture

A move goes **mod → api → relay → program**, and state comes back **program → api → mod**:

- `apps/mod`: a Claude Code mod (hooks module, not a Node app). It only sends intents (`POST /v1/play`) and draws `GET /v1/state`. Every `$` call lives in `hooks/register.tsx`; the other files are pure functions over data (views, keys, guards). It owns the api↔mod protocol, `hooks/protocol.ts`, which `apps/api` imports as `@tilt/mod/protocol`.
- `apps/api` (Hono + Postgres): device-code login for the mod, `buildState` (chain + indexer + competitions), intents, rate limits, sponsors and competitions (`pnpm --filter @tilt/api admin`). It reaches the chain only through the relay.
- `apps/wallet` (relay, private network only): Privy signers, fee payer, sending transactions to the rollup. It validates requests with the schemas in `packages/contract`.
- `packages/contract`: the program IDL (synced from `chain/` by `chain/scripts/sync-idl.sh`, checked by `scripts/ci.sh`) and the relay API zod schemas. It is the only boundary between Eli's and Armand's zones.
- `chain/`: one Anchor program, `tilt`. Money stays on Solana (USDC vault + per-player `Ledger`); rounds run in a MagicBlock Ephemeral Rollup with MagicBlock VRF; withdrawals are paid on Solana by a Magic Action. Game rules are pure Rust in `programs/tilt/src/games/`. Details: `chain/README.md`; ops: `docs/runbook.md`.
- `apps/web` (Next.js): landing, login confirmation, deposits and withdrawals (the mod never moves money).
- `packages/play`: harness-agnostic client core (session, API client, text renderer). It reuses the mod's pure modules by relative path.
- `harnesses/`: one folder per coding agent, plus a companion terminal app for hook-only agents. Index: `harnesses/README.md`.

Amounts cross every boundary as integer USDC base units (6 decimals) in decimal strings.

## Core principles

1. **Simplicity first.** Pick the simplest solution that fully works. No speculative abstractions, no frameworks or layers "for later," and no config for things that never change. YAGNI.
2. **Solve the actual problem.** Do what was asked. Don't widen the scope, refactor unrelated code, or add unrequested features. If you see something worth doing, mention it in one line and don't do it.
3. **Read before you write.** Understand the surrounding code first, then match its style, naming, and patterns. Consistency beats personal preference.
4. **Small, focused changes.** One concern per change. Keep diffs easy to review.
5. **Boring technology.** Use the standard library and well-established tools before reaching for a new dependency. Every dependency has to justify itself.
6. **Make it work, make it right, then make it fast**, in that order. Optimize only with evidence such as profiling or a measured bottleneck.

## Code quality

- Name things clearly. Good names do more than comments do.
- Write small functions that each do one thing. Keep nesting shallow and return early.
- Comments explain **why**, not what. Don't narrate obvious code.
- No dead code, commented-out blocks, or leftover debug logs.
- Don't duplicate logic. Also don't abstract too early: wait until the third repetition, and only when the cases are truly the same.
- Use types where the language supports them. Avoid `any` and similar escape hatches.
- Handle errors at the right level. Fail loudly and clearly, and never swallow errors silently. Validate input at system boundaries, such as user input and external APIs, and trust internal code.
- No magic numbers or strings. Give them a name if their meaning isn't obvious.

## Security

- Never hardcode secrets. Use environment variables and keep `.env*` out of git.
- Validate and sanitize all external input. Use parameterized queries.
- Apply least privilege to keys, permissions, and access.
- This project handles real money. Security is non-negotiable; follow spec §10 for every feature. Key rules:
  - **The server is authoritative.** Clients (mod, web) only send intents. Never trust client-supplied state, results, or randomness.
  - **Fail closed.** On any doubt, error, or inconsistency, refuse and block rather than pay out.
  - **Money integrity:**
    - Amounts are integer base units, never floats.
    - Every money movement is idempotent (unique key) and audit-logged.
    - Balances can never go negative, enforced where they live: by the program on-chain, by DB constraints for off-chain records, not just by app code.
    - Guard against concurrent requests with locks or serializable transactions.
  - **No private keys** in code, local `.env` files, or logs.
  - **Rate-limit every endpoint.** Assume bots, replayed requests, and people reading the mod's source.
  - The mod never reads the user's prompts, code, or tool calls, and never runs shell commands.

## Testing

- Test behavior, not implementation details.
- Add tests for non-trivial logic and for every bug fix (a regression test).
- Before calling a task done, run the relevant tests, linter, and type checker. If something fails, say so with the output. Never claim success without checking.
- Money, game, and RNG code needs ≥ 90% coverage, property tests for invariants, and concurrency tests (spec §11.2).
- A feature is only done when it meets spec §11.4.

## Workflow

- **Plan before big changes.** If a task touches several files or involves an architectural decision, give a short plan first. Small, clear tasks go straight to implementation.
- **Ask only when it actually matters.** If a decision is ambiguous and hard to reverse, ask. Otherwise pick a sensible default and state it.
- **Verify.** Run the code, tests, or build. Don't assume.
- **Be honest.** If you're unsure, say so. If you made a mistake, say it directly and fix it.
- **Destructive actions** such as deleting files, rewriting history, or dropping data need confirmation first.

## Git

- **Read `docs/git-workflow.md` before any git or GitHub action**, and follow it: one branch per task, delete branches once merged, close abandoned PRs, keep the repo clean.
- Commit only when asked.
- Commit messages: imperative mood and a concise subject line (`Add user login`, not `added stuff`). Explain the *why* in the body if it isn't obvious.
- Never commit secrets, build artifacts, or `node_modules`.
- Push only when asked. Never force-push `main`.
- Once code exists, work on a branch and open a PR to `main`; don't push code directly to `main`.
- Every PR includes a `Sécurité :` line describing the threat considered (or "aucun impact").
- PRs touching money, the contract, sessions, RNG, or rate limits need review from both Eli and Armand.

## Communication

- Be concise and direct. Skip filler and over-explanation.
- Once a task is done, summarize in 1–3 lines what changed and anything the user needs to know.
- Point to code as `path/to/file:line`.

## Anti-patterns to avoid

- Over-engineering: interfaces with a single implementation, factories for one type, premature generalization.
- Adding a library to save 10 lines.
- Wrapping everything in try/catch "just in case."
- Large rewrites when a targeted fix will do.
- Silently changing behavior outside the task.
- Writing a lot of code before checking that the approach works.
