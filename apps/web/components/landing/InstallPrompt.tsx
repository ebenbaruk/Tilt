import { CopyButton } from "@/components/site/CopyButton";
import styles from "./InstallPrompt.module.css";

/** What a player pastes into their coding agent: the agent finds its Tilt integration and audits it before installing.
 *  docs/onboarding.md carries the same prompt for invited testers. */
export const INSTALL_PROMPT = `Install Tilt, the casino at https://github.com/ebenbaruk/Tilt, in the coding agent you are running in. Audit it before anything runs, and stop at the first problem.

1. Identify the agent you are running in and its folder: Claude Code 2.1.287+ (apps/mod); omp or pi (harnesses/pi); OpenCode or Kilo Code (harnesses/opencode); DeepSeek Harness (harnesses/deepseek); Amp (harnesses/amp); GitHub Copilot CLI (harnesses/copilot); Grok Build or grok-cli (harnesses/grok); Qwen Code (harnesses/qwen); Kimi Code (harnesses/kimi); Factory Droid (harnesses/droid); Cursor CLI (harnesses/cursor); Codex CLI (harnesses/codex); Gemini CLI (harnesses/gemini); goose (harnesses/goose); Cline (harnesses/cline); Crush (harnesses/crush); CodeWhale (harnesses/codewhale); Aider (harnesses/aider). If none matches, stop and tell me Tilt has no integration for it yet.
2. Fetch it without installing. Claude Code: \`claude plugin marketplace add ebenbaruk/Tilt\` (\`claude plugin marketplace update tilt\` if it is already there); <folder> is its installLocation in \`claude plugin marketplace list --json\`. Any other agent: \`git clone --depth 1 https://github.com/ebenbaruk/Tilt ~/.tilt/src\` (\`git -C ~/.tilt/src pull --ff-only\` if it is already there); <folder> is ~/.tilt/src. If GitHub refuses, stop: my access to the repo is missing (invite not accepted, or git without credentials: \`gh auth login\`, then \`gh auth setup-git\`). Note \`git -C <folder> rev-parse HEAD\`.
3. Audit the code that will run, and confirm each point with file:line. Claude Code: <folder>/apps/mod. Others: <folder>/harnesses/<name> with its README.md, packages/play/src, apps/mod/hooks/{protocol,guards,keys,format,model}.ts, and harnesses/companion if the README uses it.
   - network calls only to the Tilt API URL;
   - the only command it runs opens the login URL in my browser;
   - files written only under ~/.tilt, plus the harness config the README tells you to edit (Claude Code: only its own plugin settings);
   - hook scripts never read stdin, and nothing reads my prompts, your replies, my code, tool calls or transcripts;
   - no install script, and nothing downloaded at run time.
   Flag anything else it can do and anything obfuscated. Give me a verdict with the commit you audited, and wait for my go.
4. On my go, ask me for the API URL from my invite (it must start with https://). Claude Code: \`claude plugin install tilt@tilt --scope user\`, check that \`diff -r <folder>/apps/mod <installPath>\` (installPath from \`claude plugin list --json\`) shows nothing but the .in_use marker, then \`printf '%s\\n' '{"apiUrl":"<url>"}' | claude plugin configure tilt@tilt --values-stdin\`. Others: install exactly as <folder>/harnesses/<name>/README.md says, with <TILT_DIR> = ~/.tilt/src and the URL as TILT_API_URL or apiUrl, as it says.
5. Tell me how to start playing in this agent (its key or command, or the companion command to run in a split pane) and how to log in.`;

export function InstallPrompt() {
  return (
    <div className={styles.snippet}>
      <div className={styles.head}>
        <span className={styles.label}>paste into your coding agent</span>
        <CopyButton text={INSTALL_PROMPT} label="copy prompt" />
      </div>
      <pre className={styles.code} aria-label="Install prompt">
        <code>{INSTALL_PROMPT}</code>
      </pre>
    </div>
  );
}
