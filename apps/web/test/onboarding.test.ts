import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTALL_PROMPT } from "@/lib/install-prompt";

const ONBOARDING = new URL("../../../docs/onboarding.md", import.meta.url);
// Published as the client repo's README (scripts/publish-client.sh): what testers see on GitHub.
const CLIENT_README = new URL("../../../scripts/client/README.md", import.meta.url);

describe("install prompt", () => {
  it.each([
    ["the testers' onboarding doc", ONBOARDING],
    ["the client repo's README", CLIENT_README],
  ])("is the same on the landing and in %s", (_, file) => {
    const doc = readFileSync(file, "utf8");
    const block = doc.match(/```text\n([\s\S]*?)\n```/);
    expect(block?.[1]).toBe(INSTALL_PROMPT);
  });

  it("gives the agent one API URL in the client README, as a bare https origin", () => {
    // The prompt pastes it inside quotes into a shell command: anything beyond an origin could escape them.
    const lines = readFileSync(CLIENT_README, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("API URL: "));
    expect(lines).toHaveLength(1);
    const url = lines[0]?.match(/^API URL: `([^`]*)`/)?.[1];
    expect(url).toMatch(/^https:\/\/[a-z0-9.-]+(:\d+)?$/);
  });

  it("sends testers to the client repo, never to the monorepo", () => {
    expect(INSTALL_PROMPT).toContain("github.com/ebenbaruk/tilt-client");
    expect(INSTALL_PROMPT).not.toMatch(/ebenbaruk\/Tilt\b/);
  });

  it("needs no invite: the client repo is public", () => {
    expect(INSTALL_PROMPT).not.toMatch(/invit/i);
  });
});
