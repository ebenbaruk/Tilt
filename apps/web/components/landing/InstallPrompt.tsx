import { CopyButton } from "@/components/site/CopyButton";
import styles from "./InstallPrompt.module.css";

/** What a player pastes into Claude Code: the agent audits the mod before installing it.
 *  docs/onboarding.md carries the same prompt for invited testers. */
export const INSTALL_PROMPT = `Install Tilt, the Claude Code mod at https://github.com/ebenbaruk/Tilt. Audit it before anything runs, and stop at the first problem.

1. Check the harness. Tilt runs only in Claude Code 2.1.287 or later, as a mod. If you are another agent (Codex, Grok, omp...) or \`claude --version\` is older, stop and tell me: there is nothing to set up for you yet.
2. Fetch it without installing: run \`claude plugin marketplace add ebenbaruk/Tilt\` (\`claude plugin marketplace update tilt\` if it is already there). If GitHub refuses, stop: my access to the repo is missing (invite not accepted, or git without credentials: \`gh auth login\`, then \`gh auth setup-git\`). Find its folder (installLocation in \`claude plugin marketplace list --json\`) and note \`git -C <folder> rev-parse HEAD\`.
3. Audit <folder>/apps/mod, the only code Claude Code loads (hooks/hooks.json names the entry). Read every file in hooks/, plus .claude-plugin/plugin.json and package.json, and confirm each point with file:line:
   - no install script and no runtime dependency;
   - network calls only to its apiUrl setting;
   - the only command it runs is \`open <login url>\` on /tilt login, and only for a URL on the API's own site;
   - no file system access, and nothing that reads my prompts, your replies, my code, tool calls or transcripts;
   - it stores only its session token and its own choices, and changes only its own settings;
   - the clipboard only when I press w on a win, sounds only from its own sounds/ folder.
   Flag anything else it can do and anything obfuscated. Give me a verdict with the commit you audited, and wait for my go.
4. On my go: \`claude plugin install tilt@tilt --scope user\` (\`claude plugin update tilt@tilt\` if it is already installed). Then check that \`diff -r <folder>/apps/mod <installPath>\` (installPath from \`claude plugin list --json\`) shows nothing but Claude Code's .in_use marker: what is installed is what you audited.
5. Set the API URL from my invite (ask me for it; it must start with https://): \`printf '%s\\n' '{"apiUrl":"<url>"}' | claude plugin configure tilt@tilt --values-stdin\`.
6. Tell me to restart Claude Code and type /tilt login.`;

export function InstallPrompt() {
  return (
    <div className={styles.snippet}>
      <div className={styles.head}>
        <span className={styles.label}>paste into claude code</span>
        <CopyButton text={INSTALL_PROMPT} label="copy prompt" />
      </div>
      <pre className={styles.code} aria-label="Install prompt">
        <code>{INSTALL_PROMPT}</code>
      </pre>
    </div>
  );
}
