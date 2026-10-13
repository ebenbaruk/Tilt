# UI kit — Tilt in the agent CLI

The primary Tilt surface: a panel rendered inside a terminal coding-agent session (Claude Code, Codex).

- `index.html` — interactive composition built from `components/`. Blackjack is playable (hit, stand, double, deal); the agent "finishes" after 9s to show the hand-off notice.
- Full reference prototype with all three games and keyboard control: `../../Tilt in Agent CLI.dc.html`.

Screen anatomy, top to bottom: meta line → user prompt → agent transcript + spinner → **TiltPanel** (header, notice, game, sidebar) → prompt input → hint row.
