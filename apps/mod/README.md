# Tilt for Claude Code

A Claude Code mod that opens a small casino pane (blackjack, roulette, baccarat, slots) while your agent works. On a narrow terminal it shows a compact band above the prompt instead. Bets are real USDC, settled on-chain by Tilt (see `docs/spec.md`).

## What the mod reads and sends

It reads:

- the **start and end of each turn**: only that a turn started, and when it ended, how long it took and whether it finished, was interrupted or failed. It never reads your prompt, the agent's answer, your code, files, tool calls or transcripts.
- its own `/tilt` command, its pane and the band above the prompt.
- its own settings (`apiUrl`, `layout`, `cards`, `autoOpen`, `sound`) and its own store, which holds your Tilt session token and whether you have made a first move. `/tilt setup` changes only its own settings rows, as `/config` would.
- Claude Code's `theme` setting, only to pick light or dark colors.

It sends, only to the Tilt API (`apiUrl`):

- `POST /v1/auth/device` and `POST /v1/auth/device/token` to log in with a device code.
- `GET /v1/state` for your balance, current round, sponsor and leaderboard.
- `POST /v1/play` and `GET /v1/intents/:id` for the moves you make with the keys. Game moves only: deposits and withdrawals happen on the web.
- `POST /v1/impressions` with the sponsor's name and how many seconds its block was on screen.

It puts text on your clipboard only when you press `w` on a big win: a line with the amount, the game and the sponsor, nothing about your work. With `sound` on, it plays its own two short sounds (`sounds/`).

It runs one command on your machine, `open <login url>`, when you type `/tilt login`. If that fails, the pane shows the link and the code instead. The mod opens or shows the login URL only if it is on the API's own site: `https` (plain `http` only on loopback, like `apiUrl`), on the API's host or its parent domain (`api.tilt.xyz` → `tilt.xyz`); with a loopback `apiUrl`, any loopback host. Any other URL fails the login. It hooks no other event, uses no file system access, and runs nothing else.

## Install

In Claude Code:

```
/plugin install tilt --marketplace ebenbaruk/Tilt
```

Answer `y` to add the marketplace, pick a scope, then set where the table sits on the screen that follows (you can change it any time). Then `/tilt login`, confirm the code in your browser, and play.

## Make it yours

`/tilt setup` shows each choice with a small preview and saves the one you press; the same rows are in `/config`.

- **Layout** (`1` side, `2` bottom, `3` compact). Side: a pane, docked beside the transcript in fullscreen (`"tui": "fullscreen"`), under it otherwise. Bottom: the whole table above the prompt, no pane, in every mode. Compact: two lines above the prompt; `/tilt` still opens the pane.
- **Cards** (`l` large, `s` small). Large: the five-row cards, each overlapped by the next. Where they would push the keys out of the pane (a short terminal, many hands), the table draws small ones by itself.
- **When the agent starts** (`a`): open Tilt without taking the keyboard, or wait for `/tilt`.
- **Sounds** (`m`): a short sound on a deal and on a win. Off by default.

Colors follow Claude Code's theme: a light theme gets darker pink and gold.

## Use

- `/tilt` opens the pane (with the bottom layout, the table is already above the prompt). `/tilt login` and `/tilt logout` manage your session; to switch accounts, `/tilt logout` first. `/tilt setup` moves the table and sizes the cards.
- Blackjack plays 1 to 6 hands against one dealer, at the same bet on each hand, left to right: the hand to play is marked `▶`. A pair splits into two hands (at most 4 splits a round, so up to 10 hands, wrapped to the pane's width); hands born from a split are marked `split`, and their 21 on two cards pays 1:1, not as a blackjack. Split aces get one card each.

Letter keys work everywhere (the pane and the band, inline or fullscreen):

- `ctrl+x tab` gives the pane (or the band) the keyboard; `Esc` hands it back.
- `1`–`9` switch to a game of the page shown in the header, `0` flips to the next page of games (12 games on two pages); not mid-round: a blackjack hand still to play, `▶`, a Mines, Hilo or Tower board in play, or a draw in progress keeps its game, and the key says so. `v` / `b` lower / raise the bet per hand (held at the table's limits), `n` deals, spins or plays.
- Blackjack: `j` / `k` one hand fewer / more (1 to 6), `h` hit, `s` stand, `d` double, `p` split (first two cards of the same value), all on the hand marked `▶`. Split aces take one card each and are finished, as in a casino: their hands say `· 1 card`.
- Roulette: a spin carries up to 20 bets, each a stack of chips. `v` / `b` size the chip; `r` red, `k` black, `o` odd, `e` even, `l` low, `g` high put a chip on that bet; `s` / `d` move the cursor (shown inverse) one cell over 0–36, the dozens, then the `2:1` columns, `f` / `h` move it across the felt (three numbers at a time along a row, 0 and the row's `2:1` at its ends: any number in a few presses), `a` puts a chip under it, `x` takes its chips off; `u` takes the last chip back, `q` clears the table, `n` spins them all (`roulette_chips`). A cell's stacks add up to the table maximum at most. Each cell with chips shows `●` and its stake (a number too narrow for both keeps its number, the stake shows on the cursor's line), with `on the table 2.30 · 6 chips · max win 31.50` above the layout (max win: the best pocket's gain over the stake, before the fee); a balance short of that stake is said before `n`. The chips stay after a spin, so `n` (or `Space` at the table) bets the same layout again. Once the ball lands, the pocket and the winning cells are lit. In fullscreen, in the side pane or the bottom band, a click on any cell (a number, a dozen, a `2:1`, an outside bet) adds a chip, as its key would, and `undo`, `clear` and the spin are buttons; the main screen reports no clicks, so there the line under the layout recalls the keys. The wheel and the layout take the widest cells the column fits (narrower beside the sidebar); where the room is short the wheel is a single row.
- Baccarat: `p` player, `y` banker, `t` tie.
- Slots: `x` normal, `f` fast (the reels land three times sooner), `t` turbo (no spin: the draw shows as soon as the chain has it).
- Mines: `j` / `k` one mine fewer / more (1 to 24, 3 by default); in play, `a`–`y` reveal the tile with that letter (5×5, row by row, the letter in the tile's corner) and `z` cashes out, from the first safe tile. In fullscreen, a click on a tile reveals it.
- Dice: `j` / `k` win chance down / up, `o` over or under. Limbo: `j` / `k` target multiplier. Flip: `h` heads, `t` tails, `j` / `k` coins (1 to 10). Keno: `j` / `k` how many numbers (1 to 10), `r` new random numbers; in fullscreen (pane or band), click a number to pick it. Wheel: `j` / `k` segments, `r` risk.
- Hilo: `n` deals the first card; then `h` higher or same, `l` lower or same (on a king, `l` is strictly lower; on an ace, `h` strictly higher), `s` skip (10 per round), `z` cash out. Tower: `j` / `k` difficulty; in play, `a`–`d` pick a tile of the current level (the lit one), `z` cashes out. In fullscreen, `↑` / `↓` step the game's own setting.
- A move is sent once: until the table shows it, the keys are dimmed and do nothing, and for 1.5 s after, the keys of the move's screen stay dimmed on letters the new screen does not use, so the rest of a mashed `n` or `s` is caught. Past that, a letter the pane has no key for goes to the prompt (Claude Code's own behavior), so a mashed `Enter` after it would send it to the agent.

In the fullscreen layout (`claude --settings '{"tui":"fullscreen"}'`), in the side pane or the bottom band, click the table to give it the keys. Only a click does: `ctrl+x tab` gives the pane the letters, not Space, Enter or the arrows, and once the keyboard leaves the pane the table needs a click again (the table says so). In the band, `Esc` or a click on the prompt hands them back. Without it, `←` is Claude Code's own (the agents view).

- `Space` or `Enter` plays a new round with the same bet and hands; in a blackjack turn `Space` hits, `Enter` stands, `d` doubles, `p` splits.
- `←` / `→` lower / raise the bet (the chip at roulette), `↑` / `↓` add / remove a blackjack hand (move the roulette cursor), `1`–`4` switch game. `Esc` hands the keys back.
- The table deals the cards one by one (at baccarat: player, banker, player, banker, then any third cards) and counts up a win; the main screen deals them one by one too, the result showing after the last card. The roulette wheel turns steadily while the chain draws, then slows into the drawn pocket before the ball shows. The Wheel game is drawn as a wheel of fortune: a disc of wedges colored by what they pay (the legend under it), in a gold rim around a hub, under a fixed `▼` (the biggest that fits the room the table has, whatever the card size: 31 columns across, else 25, else 17, else a strip of the segments). The disc turns the same way, then slows over a few laps until the drawn segment stops under the pointer; beside it, the segments and risk give way to the landed multiplier. The result, balance and any celebration wait for it to stop.

When a turn starts, the pane opens without taking the keyboard. When it ends the table stays, with `✓ agent finished in 6m 14s · your hand is saved`. `ctrl+x tab` gives it the keys and, pressed again, hands them back (as `Esc` does); `ctrl+x x` or ✕ hides it until `/tilt`. A pane left open comes back by itself when the session starts over: at the next launch, or back from Claude Code's agents view (`←`, then `Esc`). That return moves the session to a new process drawn fullscreen, where a pane would dock on the side: if you played with the pane under the transcript, the table comes back above the prompt instead (as with `layout: bottom`, for that session).

Around the table:

- Your first time, a guide says how to give Tilt the keys and deal; it goes after your first move.
- The bet and, at blackjack, the hands are steppers: `v ◂ bet 0.50 ▸ b`, `j ◂ ●●○○○○ 2 hands ▸ k`. If your balance does not cover the bet, the table says so before you press `n`, with a link to deposit on the web.
- A blackjack or baccarat deal shows its cards face down at once, then turns them over as the chain deals them.
- A win sparkles across the table once its result shows; a win of twice the stake or more sets off fireworks and gets a banner; `w` copies a line to share.
- The footer counts this session (`session +2.30 · 14 rounds · 22m`), as the mod saw rounds settle; the leaderboard says how far the next rank is.

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
