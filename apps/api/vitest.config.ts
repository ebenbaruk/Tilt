import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database tests share one Postgres and truncate it between tests.
    fileParallelism: false,
    // Request logs are noise in tests; warnings and errors still show.
    onConsoleLog: (log) => !log.includes('"level":"info"'),
  },
});
