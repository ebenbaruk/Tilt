# Tilt for GitHub Copilot CLI

A Copilot CLI extension that adds `/tilt`: you play Tilt through Copilot's select dialogs while
the agent works, over one line (your balance and the last result), also printed in the timeline.
The table itself is the companion's (`harnesses/companion/bin/tilt` in a split pane): the CLI runs
extensions under plain Node, which cannot load the Claude Code mod's view (TSX). The agent's working/idle state comes from the
`assistant.turn_start` and `session.idle` events, used for their timing only. The extension never
reads prompts, replies, tool calls or event payloads, and runs no shell command except the
platform opener (`open`, `xdg-open`, `rundll32`) for the login page.

Extensions are an **experimental** Copilot CLI feature and may change.

## Files

- `extension.mjs`: the entry the CLI runs with Node. It lets Node load the shared TypeScript
  session (`packages/play/src/core.ts`, plain TypeScript only) straight from your clone, then
  joins the session.
- `tilt.ts`: the `/tilt` command, the play loop and the turn tracking.
- `copilot.ts`: the few SDK types used, declared locally (the SDK ships inside the CLI).

## Install

1. Point Tilt at its API in the environment you start Copilot from (no host is ever guessed):
   `export TILT_API_URL=https://…`
2. Link this folder as a user extension. Replace `<TILT_DIR>` with the absolute path of your clone:

   ```sh
   mkdir -p ~/.copilot/extensions
   ln -s <TILT_DIR>/harnesses/copilot ~/.copilot/extensions/tilt
   ```

3. Start Copilot with extensions on: `copilot --experimental` (or `/experimental on` in a running
   session, then `/clear`). `/extensions manage` should list `tilt` under **User** as running.
   Problems are logged under `~/.copilot/logs/extensions/`.

## Play

| Command        | What it does                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------- |
| `/tilt login`  | Opens the login page and prints the code to confirm; the timeline says when you're in.        |
| `/tilt`        | Opens a dialog with the line and the keys; pick moves until you cancel it.                    |
| `/tilt status` | Prints the line in the timeline: `TILT 99.90 · Blackjack · −0.10 · agent idle`.               |
| `/tilt <key>`  | Presses one key (e.g. `/tilt 1`), then prints the line. Use it where dialogs are unavailable. |
| `/tilt logout` | Signs out on this machine.                                                                    |

The extension also writes the turn file `~/.tilt/agent.json`, so the companion app
(`harnesses/companion/bin/tilt` in a split pane) draws the table, played with single keys, and
follows Copilot's turns.

## Uninstall

`rm ~/.copilot/extensions/tilt`, then `/clear` or restart Copilot. `~/.tilt/session.json` holds the
login shared by every Tilt harness; delete it (or `/tilt logout` first) to sign out everywhere.

## Verified vs not

Verified against the docs and SDK source (2026-10-29, CLI 1.0.105):

- Extension location, `joinSession`, `commands` with `ctx.args`, `session.log`, `--experimental`,
  `/extensions manage`: <https://docs.github.com/en/copilot/tutorials/create-an-extension>.
- `assistant.turn_start` and `session.idle` events: <https://github.com/github/copilot-sdk/blob/main/nodejs/docs/examples.md>.
- `session.ui.select(message, options)` returning the choice or `null`, gated by
  `session.capabilities.ui.elicitation`; `requestedEnvironmentVariables` (the CLI strips sensitive
  variables from extensions): `nodejs/src/session.ts`, `nodejs/src/types.ts`, `nodejs/src/extension.ts`
  and `nodejs/docs/extensions.md` in <https://github.com/github/copilot-sdk>.
- On 2026-11-24, `tilt.ts` loaded under plain Node 22.23 with type stripping and the resolve hook
  of `extension.mjs`, and answered `/tilt status`, `/tilt s` and `/tilt` against a fake session and
  the fake API (`bun packages/play/test/fake-api.ts`). The SDK import of `extension.mjs` itself
  comes from the CLI and was not loaded.

Not verified (no Copilot CLI was run):

- That the CLI runs extensions on a Node with type stripping (22.18+) and `module.registerHooks`
  (22.15+). The 1.0.105 linux binary embeds Node v24.22.1, which has both, but how it forks
  extensions is not documented.
- That a symlinked extension folder is discovered. If it is not, create a real
  `~/.copilot/extensions/tilt/` folder whose `extension.mjs` holds the single line
  `import "<TILT_DIR>/harnesses/copilot/extension.mjs";`. Whether the CLI then resolves the SDK
  import from your clone is also unverified.
- How the timeline renders `session.log` text and whether the select dialog keeps its line breaks.
  The line is plain text cut at 72 columns because the extension cannot read the terminal width.
- Whether `TILT_API_URL` counts as sensitive; if it does, the CLI asks once to pass it through.
