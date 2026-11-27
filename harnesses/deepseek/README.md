# Tilt for DeepSeek Harness (dsh)

A Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), a
developer preview whose APIs still change. It follows `agent/status` (`running`/`idle`, no
content) and adds `/tilt`, which answers with one line: your balance and the last result. The
table is the companion app's (`harnesses/companion/bin/tilt` in a split pane): dsh runs plugins
under plain Node, which cannot load the Claude Code mod's view (TSX). The plugin never reads prompts,
replies, tool calls or session events, and runs no shell command except the platform opener
(`open`, `xdg-open`, `rundll32`) for the login page.

## Files

- `index.mjs`: the entry dsh loads. It lets Node load the TypeScript plugin and the shared session
  (`packages/play/src/core.ts`, plain TypeScript only) straight from your clone.
- `tilt.ts`: the plugin (`name`, `inject`, `apply`): turn tracking and `/tilt`.
- `dsh.ts`: the few dsh types used, declared locally.
- `package.json` + `cordis.patch.yml`: make this folder a dsh bundle that mounts the plugin.

## Install

1. Point Tilt at its API in the environment you start dsh from: `export TILT_API_URL=https://…`
   (no host is ever guessed). You can set `apiUrl` on the `tilt` row in your profile's
   `cordis.patch.yml` instead; see the comment in `cordis.patch.yml`.
2. Add this folder to the profile you run. Replace `<TILT_DIR>` with the absolute path of your clone:

   ```sh
   dsh plugin --profile tui add <TILT_DIR>/harnesses/deepseek   # terminal UI profile
   dsh plugin --profile web add <TILT_DIR>/harnesses/deepseek   # or the web profile
   ```

   A local path is linked, not copied, so the plugin keeps finding `packages/play` in your clone.
   Check the layer with `dsh --profile tui --dump-config` (it shows a `@tilt/dsh` layer).

3. Start dsh as usual (`dsh --profile tui`, `dsh web`).

## Play

| Command        | What it does                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------- |
| `/tilt login`  | Opens the login page and answers with the code to confirm.                                    |
| `/tilt`        | Answers with one line, `TILT 99.90 · Blackjack · −0.10 · agent idle`, and where the table is. |
| `/tilt <key>`  | Presses one key (e.g. `/tilt 1`).                                                             |
| `/tilt logout` | Signs out on this machine.                                                                    |

The plugin also writes the turn file `~/.tilt/agent.json`, so `harnesses/companion/bin/tilt` in a
split pane draws the table, played with single keys, and follows dsh's turns in any front end.

## Uninstall

`dsh plugin --profile tui remove @tilt/dsh` (same for `web`) removes the dependency and its layer.
`~/.tilt/session.json` holds the login shared by every Tilt harness; delete it (or `/tilt logout`
first) to sign out everywhere.

## Verified vs not

Verified against deepseek-ai/deepseek-harness `main` at commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (2026-10-28):

- Plugin form (`name`, `inject`, `apply(ctx, config)`), `ctx.effect`:
  `docs/user/develop/basic/index.md`, `docs/cordis-tutorial/02-lifecycle-and-effects.md`.
- Bundle manifest (`dsh.bundle.patch`), `dsh plugin --profile <p> add <path>` linking a local
  checkout, `remove`: `docs/user/develop/basic/publish.md`.
- `agent/status` payload `{ agent, status }` with `running`/`idle`, and `agent/disposed`:
  `packages/core/agent/src/runtime-types.ts`.
- `ctx.commands.register({ name, description, input, handler({ rawInput }) })` returning
  `{ kind: 'success' | 'error', text }`: `packages/interaction/commands/README.md`, `src/types.ts`.
- On 2026-11-24, `index.mjs` loaded under plain Node 22.23 with type stripping and its resolve
  hook, and answered `/tilt`, `/tilt login` and `/tilt n` against a fake context and the fake API
  (`bun packages/play/test/fake-api.ts`).

Not verified:

- That installed dsh loads `index.mjs` with Node's default type stripping (Node 22.18+, dsh asks
  for `^22.19.0 || >=24.0.0`) without its own module hooks getting in the way.
- How the TUI and the web client render a multi-line command answer (the line is cut at 72
  columns, with no color).
- No dsh was installed or run.
