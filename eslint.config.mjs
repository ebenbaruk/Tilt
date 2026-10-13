// Lint covers Eli's apps for now (spec §11.1); Armand's zone can opt in later.
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "apps/mod/.claude-plugin/types/**", "apps/web/next-env.d.ts"],
  },
  {
    files: ["apps/api/**/*.ts", "apps/mod/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.strict],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web" } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
  },
  prettier,
);
