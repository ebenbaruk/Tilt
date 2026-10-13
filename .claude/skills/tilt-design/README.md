# Tilt Design System

Tilt is a free-to-play casino (blackjack, roulette, slots) that runs **inside AI coding agents** such as Claude Code and Codex, filling the time developers spend waiting on the agent. Winnings are real: each season, top players split a cash prize pool funded by sponsors, who get placement on tables, machines and win screens.

This repo holds everything needed to design and build Tilt surfaces: tokens, fonts, components, a UI kit and usage rules.

**Sources.** Built from the product brief (pitch text) and the reference prototype `Tilt in Agent CLI.dc.html` in this repo. No codebase, Figma or brand assets existed before this system; all values originate from that prototype.

## Products / surfaces
| Surface | Status | Location |
|---|---|---|
| CLI panel inside the agent terminal | Defined | `ui_kits/cli/` |
| Share card (X / TikTok) | Inline banner only (`WinCard`); full image card not yet designed | — |
| Public leaderboard (web) | Not yet designed | — |

## Index
```
styles.css                 entry point — @imports only; link this one file
tokens/                    colors · typography · layout (space, radii, shadow) · motion · fonts
components/core/           TerminalWindow, TiltPanel, GameTabs, KeyButton, Stat, Notice, Spinner, PromptInput
components/games/          PlayingCard + Hand, RouletteStrip (+ pocketColor), SlotReel + SlotMachine
components/tilt/           WinCard, SponsorBlock, Leaderboard, TranscriptLine
ui_kits/cli/               full CLI screen composed from components
guidelines/                foundation specimen cards (colors, type, spacing, motion, brand)
scripts/load-components.js dev loader so cards render from .jsx without a build
Tilt in Agent CLI.dc.html  reference prototype (all 3 games, keyboard control, tweaks)
SKILL.md                   Agent Skill manifest for Claude Code
```
Each component ships `Name.jsx` (implementation), `Name.d.ts` (props contract) and `Name.prompt.md` (when to use + example).

### Quick start
```html
<link rel="stylesheet" href="styles.css">
```
```jsx
<TiltPanel tabs={<GameTabs …/>} stats={<Stat label="chips" value="18,450" tone="money"/>}>
  <Hand label="YOU" total={19} cards={[{rank:'9',suit:'♥'},{rank:'K',suit:'♠'}]} />
  <KeyButton keyLabel="H" onClick={hit}>hit</KeyButton>
</TiltPanel>
```
Components import only React and style through CSS custom properties. Previewing `ui_kits/` or `components/*/*.card.html` from a clone needs a static server (`npx serve .`) because the loader fetches the .jsx files.

---

## UX principles
1. **The agent comes first.** Tilt is a guest in someone's work session. It never blocks the transcript, never steals focus from a prompt the agent is waiting on, and collapses to one line with `\``.
2. **Instant hand-off.** When the agent finishes, a green notice appears at the top of the panel. The hand is saved; returning to code costs nothing.
3. **Keyboard-first.** Every action has a single-key shortcut, displayed in gold on its button. Mouse works too, but is secondary. Game switching uses 1–9.
4. **One glance, one move.** A hand fits in a few seconds. No menus, no modals, no onboarding inside the terminal.
5. **The terminal's rules.** Monospace grid, ASCII cards, unicode glyphs, stepped animation. Tilt should look like it was always part of the CLI.
6. **Sponsors sit next to money.** Sponsor names appear with the prize pool and on win banners. Never as a standalone or interruptive ad.
7. **Wins are built to share.** Big wins (net ≥ 700 chips) produce a card pairing the win with what the agent did, shareable with one key.
8. **Free to play, stated plainly.** No purchase flows, no dark patterns, no fake urgency. Real prizes come from the season pool.

## Content fundamentals
- **Voice:** a dry, fluent dev talking to another dev. Confident, short, a little degen, never hype.
- **Person:** addresses the player as *you*; the system never says *I* or *we*. Third person for the agent ("agent finished").
- **Casing:** UI chrome and labels lowercase (`chips`, `rank`, `hit`, `deal · 500`, `review diff`). Results and status messages sentence case ("Bust at 23."). Wordmark and eyebrows ALL CAPS with tracking (`TILT`, `PRESENTED BY`, `★ BIG WIN`). Game names Title Case in tabs.
- **Numbers:** en-US grouping (18,450), never abbreviated. Real minus sign (−500, U+2212). Signed deltas on every result (+1,250 / −500).
- **Separators:** middle dot ` · ` between clauses, never pipes or dashes.
- **Key hints:** bracketed or leading key: `[1] Blackjack`, `H hit`, `⏎ review diff`, `\` hide tilt`.
- **Emoji:** none. Unicode glyphs only (see Iconography).
- **Examples:** "Agent is working. Deal a hand." · "Dealer 19 beats 17. −500" · "✓ agent finished in 31s · your hand is saved" · "“won 1,250 on blackjack while my agent fixed flaky tests”" · "free to play · real prizes".
- **Avoid:** exclamation-heavy celebration, "Congratulations", "Claim now", "Don't miss out", casino-floor clichés.

## Visual foundations
- **Color:** dark warm-grey terminal (`--ink-1` #141517) on a near-black page. Seven-step foreground ramp `--fg-1`…`--fg-7`. Four accents in one oklch family: **pink** `oklch(.74 .17 350)` = Tilt brand (wordmark, frame, active tab, jackpot 7); **gold** `oklch(.84 .13 85)` = money and attention (chips, wins, key letters, spinner); **green** `oklch(.78 .12 150)` = the agent and success; **red** `oklch(.7 .17 25)` = loss and red suits. Roulette pockets use darker *felt* variants. Accents appear as text or 1px lines; fills are reserved for the active tab, roulette pockets and the one solid share button.
- **Tints:** accent-tinted bars at 6–10% alpha with 30–60% alpha borders (panel header, finish notice, win card). Never gradients.
- **Type:** JetBrains Mono only, at 13.5px / 1.55 for nearly everything. Hierarchy comes from weight (400 / 700 / 800) and color, rarely size. 18px for sponsor name, 34px for slot symbols, 11px tracked caps for eyebrows.
- **Spacing:** specific values from the prototype: 2, 4, 6, 8, 10, 12, 14, 16, 18, 22px. Panel padding 14×16; header 8×14; window body 18×22.
- **Corner radii:** small: 3px controls, 4px reels, 6px panels/inputs/win card, 10px window.
- **Borders:** 1px everywhere. The pink 55% frame marks Tilt's territory inside the terminal.
- **Shadow:** exactly one, `--shadow-window` on the terminal window. Everything inside is flat.
- **Cards (containers):** 1px border, 6px radius, optional 6–10% accent tint, no shadow.
- **Backgrounds & imagery:** none. No photos, illustrations, textures or gradients. Cards and reels are drawn with box-drawing characters and glyphs.
- **Animation:** discrete frames, like a terminal redraw. Spinner 200ms/frame; roulette 70ms frames for 1.4s; slots 80ms frames for 1.1s. No easing curves, no fades, no bounces.
- **Hover:** instant. Outlined buttons turn border + label pink. Ghost links go from fg-4 to fg-1.
- **Press / focus:** no shrink. Focus ring `2px solid --tilt-gold`.
- **Transparency & blur:** alpha only on tints and roulette neighbours; never backdrop blur.
- **Layout:** panel = header row + optional notice + grid (`minmax(0,1fr) 260px`). Sidebar drops below ~720px terminal width. Header items wrap, never truncate. Max window width 1080px.

## Iconography
- **No icon font, no SVG icons.** Tilt uses Unicode glyphs that every terminal can render: `●` tool call, `└` tool output, `✓` done, `★` win, `›` prompt, `·` separator, `▸` expand, `▲` ball marker, `⏎` return, `↺` replay, `⋮` gap, `␣` space key, suits `♠ ♥ ♦ ♣`, slot symbols `7 ◆ ★ ♣ ¤`, spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, card back `░`.
- Glyphs take the color of their role (green agent, gold money, pink brand).
- **No emoji.**
- **Logo:** none exists yet. The wordmark is `TILT` set in JetBrains Mono 800, +0.12em tracking, pink. Do not draw a mark until one is designed.
- **Sponsor logos:** render the sponsor name in type (fg-1, 800). If a logo is supplied, show it monochrome.

## Fonts
JetBrains Mono, loaded from Google Fonts (`tokens/fonts.css`). For production, self-host the woff2 files in `assets/fonts/` and replace the @import with @font-face rules. Inside a real terminal, Tilt inherits the user's monospace font.

## Intentional additions
- `TerminalWindow`, `TranscriptLine`, `PromptInput`: they stage the host agent session in mocks. Tilt doesn't ship them in production; the host CLI draws these.
- `scripts/load-components.js`: dev-only loader for previews without a build step.
