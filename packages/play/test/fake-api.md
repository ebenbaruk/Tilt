# Fake Tilt API (dev only)

Smoke-tests a harness integration without the chain, relay or Postgres: one in-memory player, random outcomes, nothing saved.

```sh
bun packages/play/test/fake-api.ts 8787      # or: npx tsx packages/play/test/fake-api.ts 8787
TILT_API_URL=http://127.0.0.1:8787 <harness>  # e.g. harnesses/companion/bin/tilt
```

- Use `127.0.0.1`, not `localhost`: the login page it sends (`http://127.0.0.1:<port>/connect`) must be on the api's own site.
- Login: code `TILT-TEST`, approved on the 2nd poll, token `fake-token`. Balance 100 USDC, bets 0.10 to 10 USDC.
- Plays dice, limbo, flip, keno, wheel, slots, roulette and blackjack (hit, stand, double; no split). Other games answer `INVALID_REQUEST`.
- Every move is `drawing` for about 1 s, then settles. Restart the server to reset.
