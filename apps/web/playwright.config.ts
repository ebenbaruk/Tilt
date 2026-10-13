import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** Fake API origin: every call to it is answered by page.route mocks in the tests. */
const E2E_API_URL = "http://api.tilt.test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Builds with the e2e env: NEXT_PUBLIC_* values are inlined at build time.
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_API_URL: E2E_API_URL,
      NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
      // Privy checks the id is 25 chars; Privy's network is blocked in tests, so it never initializes.
      NEXT_PUBLIC_PRIVY_APP_ID: "cm00000000000000000000e2e",
    },
  },
});
