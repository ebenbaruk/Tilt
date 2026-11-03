import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTALL_PROMPT } from "@/lib/install-prompt";

const ONBOARDING = new URL("../../../docs/onboarding.md", import.meta.url);

describe("install prompt", () => {
  it("is the same on the landing and in the testers' onboarding doc", () => {
    const doc = readFileSync(ONBOARDING, "utf8");
    const block = doc.match(/```text\n([\s\S]*?)\n```/);
    expect(block?.[1]).toBe(INSTALL_PROMPT);
  });

  it("sends testers to the client repo, never to the monorepo", () => {
    expect(INSTALL_PROMPT).toContain("github.com/ebenbaruk/tilt-client");
    expect(INSTALL_PROMPT).not.toMatch(/ebenbaruk\/Tilt\b/);
  });
});
