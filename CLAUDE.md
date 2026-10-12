# CLAUDE.md

Act like a pragmatic senior engineer. Write code a strong teammate would approve quickly: correct, simple, readable, and no larger than the task needs.

## Project

- **Name:** Tilt
- **What:** A crypto casino on Solana, played inside Claude Code (a Claude Code mod) while the agent works, with a sponsor always visible. Spec: `docs/spec.md` (source of truth). Background: `docs/idea.md`, `docs/integrations.md`.
- **Status:** Spec draft v0.1, pending validation. No code yet. Open decisions are listed in the spec (§13); don't settle them in code. Ask instead.
- **Team:** Eli and Armand, each working with their own AI.
- **Ownership:** Stay inside the zone you're working for (spec §8). Never edit the other person's zone; open an issue or ask.
  - **Armand:** everything that touches money: `apps/wallet` (Privy, ledger, deposits, withdrawals, bankroll) and `chain/`.
  - **Eli:** `apps/mod` (Claude Code mod), `apps/api` (game server: games, RNG, competitions, sponsors) and `apps/web`.
  - **Shared:** `packages/contract`, the only boundary between `api` and `wallet`. Changes need both to agree.
- **Proposed stack:** TypeScript monorepo (pnpm), Node + Postgres, Next.js for web, Privy, `@solana/kit`. Not final until spec D7 is decided.
- **Repo:** Private GitHub repo `ebenbaruk/Tilt`. It must stay **private**. Never make it public or publish this code anywhere else.

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
    - Balances can never go negative, enforced by a DB constraint, not just app code.
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
