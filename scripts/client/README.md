# Tilt client

Tilt is a casino you play inside your coding agent while it works. This repo holds only the code
that runs on your machine:

- `apps/mod`: the Claude Code mod (a marketplace plugin, `tilt@tilt`).
- `packages/play`: the client core every other agent's integration shares (login, moves, the table drawn as text).
- `harnesses/<agent>`: one integration per coding agent (omp, pi, OpenCode, Codex, Gemini CLI, Cursor CLI…), plus a companion app for agents that only have hooks. Index: [`harnesses/README.md`](harnesses/README.md).

What it reads and sends is spelled out in [`apps/mod/README.md`](apps/mod/README.md) and in each harness README. In short: it only learns when a turn starts and ends, never your prompts, code, tool calls or transcripts; it talks only to the Tilt API URL you set; the one command it runs opens the login page in your browser; nothing is downloaded when it runs.

## Install

Paste the prompt below into your coding agent (Claude Code, omp, pi, OpenCode, Codex, Gemini CLI, Cursor CLI… the full list is in step 1). The agent identifies itself, fetches this repo, audits the code that will run with `file:line` references, and waits for your go before installing.

API URL: `https://tilt-casino.vercel.app` (the devnet test; the agent reads it from this line).

```text
Install Tilt, the casino at https://github.com/ebenbaruk/tilt-client, in the coding agent you are running in. Audit it before anything runs, and stop at the first problem.

1. Identify the agent you are running in and its folder: Claude Code 2.1.287+ (apps/mod); omp or pi (harnesses/pi); OpenCode or Kilo Code (harnesses/opencode); DeepSeek Harness (harnesses/deepseek); Amp (harnesses/amp); GitHub Copilot CLI (harnesses/copilot); Grok Build or grok-cli (harnesses/grok); Qwen Code (harnesses/qwen); Kimi Code (harnesses/kimi); Factory Droid (harnesses/droid); Cursor CLI (harnesses/cursor); Codex CLI (harnesses/codex); Gemini CLI (harnesses/gemini); goose (harnesses/goose); Cline (harnesses/cline); Crush (harnesses/crush); CodeWhale (harnesses/codewhale); Aider (harnesses/aider). If none matches, stop and tell me Tilt has no integration for it yet.
2. Fetch it without installing. Claude Code: `claude plugin marketplace add ebenbaruk/tilt-client` (`claude plugin marketplace update tilt` if it is already there); <folder> is its installLocation in `claude plugin marketplace list --json`. Any other agent: `git clone --depth 1 https://github.com/ebenbaruk/tilt-client ~/.tilt/src` (`git -C ~/.tilt/src pull --ff-only` if it is already there); <folder> is ~/.tilt/src. If the fetch fails, stop and show me the error. Note `git -C <folder> rev-parse HEAD`.
3. Audit the code that will run, and confirm each point with file:line. Claude Code: <folder>/apps/mod. Others: <folder>/harnesses/<name> with its README.md, packages/play/src, apps/mod/hooks/{protocol,guards,keys,format,model}.ts, and harnesses/companion if the README uses it.
   - network calls only to the Tilt API URL;
   - the only command it runs opens the login URL in my browser;
   - files written only under ~/.tilt, plus the harness config the README tells you to edit (Claude Code: only its own plugin settings);
   - hook scripts never read stdin, and nothing reads my prompts, your replies, my code, tool calls or transcripts;
   - no install script, and nothing downloaded at run time.
   Flag anything else it can do and anything obfuscated. Give me a verdict with the commit you audited, and wait for my go.
4. On my go, take the Tilt API URL from the "API URL:" line of <folder>/README.md; only if it is missing or does not start with https://, ask me for it. Claude Code: `claude plugin install tilt@tilt --scope user`, check that `diff -r <folder>/apps/mod <installPath>` (installPath from `claude plugin list --json`) shows nothing but the .in_use marker, then `printf '%s\n' '{"apiUrl":"<url>"}' | claude plugin configure tilt@tilt --values-stdin`. Others: install exactly as <folder>/harnesses/<name>/README.md says, with <TILT_DIR> = ~/.tilt/src and the URL as TILT_API_URL or apiUrl, as it says.
5. Tell me how to start playing in this agent (its key or command, or the companion command to run in a split pane) and how to log in.
```

Then restart your agent and log in (`/tilt login` in Claude Code; other agents: their README). Everything runs on Solana devnet: the USDC is test money with no value, and there is no faucet. Ask the Tilt team for test USDC with your wallet address (shown on the site's `/account` page); they mint it to that wallet (`pnpm admin mint-test`, devnet only). Deposit and withdraw on `/account`; the agent never moves money.

To update, paste the prompt again: it audits the new commit first. Never `git pull` an installed copy on its own, since it would skip the audit.

## Where it comes from

This repo is generated from Tilt's private monorepo by `scripts/publish-client.sh`; each commit names the monorepo commit it was published from. Don't send changes here: they are overwritten on the next publish.
