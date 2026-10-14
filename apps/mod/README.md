# Tilt for Claude Code

A Claude Code mod that opens a small casino pane (blackjack, roulette, baccarat, slots) while your agent works. On a narrow terminal it shows a compact band above the prompt instead. Bets are real USDC, settled on-chain by Tilt (see `docs/spec.md`).

## What the mod reads and sends

It reads:

- the **start and end of each turn**: only that a turn started, and when it ended, how long it took and whether it finished, was interrupted or failed. It never reads your prompt, the agent's answer, your code, files, tool calls or transcripts.
- its own `/tilt` command, its pane and the band above the prompt.
- its own settings (`apiUrl`) and its own store, which holds your Tilt session token.

It sends, only to the Tilt API (`apiUrl`):

- `POST /v1/auth/device` and `POST /v1/auth/device/token` to log in with a device code.
- `GET /v1/state` for your balance, current round, sponsor and leaderboard.
- `POST /v1/play` and `GET /v1/intents/:id` for the moves you make with the keys. Game moves only: deposits and withdrawals happen on the web.
- `POST /v1/impressions` with the sponsor's name and how many seconds its block was on screen.

It runs one command on your machine, `open <login url>`, when you type `/tilt login`. If that fails, the pane shows the link and the code instead. The mod opens or shows the login URL only if it is on the API's own site: `https` (plain `http` only on loopback, like `apiUrl`), on the API's host or its parent domain (`api.tilt.xyz` → `tilt.xyz`); with a loopback `apiUrl`, any loopback host. Any other URL fails the login. It hooks no other event, uses no file system access, and runs nothing else.

## Install

In Claude Code:

```
/plugin marketplace add ebenbaruk/Tilt
/plugin install tilt
```

Then `/tilt login`, confirm the code in your browser, and play.

## Use

- `/tilt` opens the pane. `/tilt login` and `/tilt logout` manage your session; to switch accounts, `/tilt logout` first.
- Blackjack plays 1 to 6 hands against one dealer, at the same bet on each hand, left to right: the hand to play is marked `▶`.

Letter keys work everywhere (the pane and the band, inline or fullscreen):

- `ctrl+x tab` gives the pane (or the band) the keyboard; `Esc` hands it back.
- `1`–`4` switch game, `v` / `b` lower / raise the bet per hand (held at the table's limits), `n` deals or spins.
- Blackjack: `j` / `k` one hand fewer / more (1 to 6), `h` hit, `s` stand, `d` double, all on the hand marked `▶`.
- Roulette: `r` red, `k` black, `o` odd, `e` even, `l` low, `g` high, `z` dozen, `c` column.
- Baccarat: `p` player, `y` banker, `t` tie.
- A move is sent once: until the table shows it, the keys are dimmed and do nothing, and for 1.5 s after, the keys of the move's screen stay dimmed on letters the new screen does not use, so the rest of a mashed `n` or `s` is caught. Past that, a letter the pane has no key for goes to the prompt (Claude Code's own behavior), so a mashed `Enter` after it would send it to the agent.

In the fullscreen layout (`claude --settings '{"tui":"fullscreen"}'`), click the table to give it the keys. Only a click does: `ctrl+x tab` gives the pane the letters, not Space, Enter or the arrows, and once the keyboard leaves the pane the table needs a click again (the table says so). Without it, `←` is Claude Code's own (the agents view).

- `Space` or `Enter` plays a new round with the same bet and hands; in a blackjack turn `Space` hits, `Enter` stands, `d` doubles.
- `←` / `→` lower / raise the bet, `↑` / `↓` add / remove a blackjack hand, `1`–`4` switch game. `Esc` hands the keys back.
- The table deals the cards one by one and counts up a win; the main screen draws it still.
- Back from the agents view, Claude Code (2.1.299) may not draw the docked pane again although it is still open: `/tilt` brings it back.

When a turn starts, the pane opens without taking the keyboard. When it ends you see `✓ agent finished in 6m 14s · your hand is saved`.

## Local development

```
claude --plugin-dir apps/mod
```

Point the mod at a local API with its `apiUrl` setting (`/config`, or `pluginConfigs.tilt.options.apiUrl` in `~/.claude/settings.json`), for example `http://127.0.0.1:8080`. Plain `http` is accepted only for `localhost` and `127.0.0.1`.

Checks, from this folder:

```
claude plugin validate .
claude plugin test .
pnpm typecheck
```

`pnpm typecheck` needs the engine's declarations in `.claude-plugin/types/` (git-ignored). An interactive `claude --plugin-dir apps/mod` session writes them.
