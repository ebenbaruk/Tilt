#!/usr/bin/env bash
# The project's CI, run on your machine before every merge (there is no GitHub CI).
# Needs the `tilt-pg` Postgres container (docs/dev.md §1), Docker (secret scan), Rust 1.89.0,
# Anchor and Claude Code. `--e2e` also runs the program, relay and api end-to-end tests
# against the local stack, which must already be running (docs/dev.md §2).
set -euo pipefail

cd "$(dirname "$0")/.."

E2E=false
for arg in "$@"; do
  case "$arg" in
    --e2e) E2E=true ;;
    *) echo "usage: scripts/ci.sh [--e2e]" >&2; exit 2 ;;
  esac
done

PG=postgres://postgres:tilt@127.0.0.1:55432
GITLEAKS_IMAGE=ghcr.io/gitleaks/gitleaks:v8.24.0
ANCHOR_WALLET=${ANCHOR_WALLET:-/tmp/tilt-admin.json}

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "install"
pnpm install --frozen-lockfile

step "typecheck, lint, format"
pnpm -r typecheck
pnpm lint
pnpm format:check

step "dependency audit"
pnpm audit --prod --audit-level high

step "secret scan"
if command -v gitleaks >/dev/null; then
  gitleaks git . --redact --no-banner
else
  docker run --rm -v "$PWD:/repo" "$GITLEAKS_IMAGE" git /repo --redact --no-banner
fi

step "contract"
pnpm --filter @tilt/contract test

step "api"
TEST_DATABASE_URL=$PG/tilt_api_test pnpm --filter @tilt/api test

step "relay"
TEST_DATABASE_URL=$PG/tilt_test pnpm --filter @tilt/wallet test

step "web"
pnpm --filter @tilt/web test
pnpm --filter @tilt/web build
pnpm --filter @tilt/web e2e

step "mod"
pnpm --filter @tilt/mod test

step "chain"
(
  cd chain
  cargo +1.89.0 fmt --all --check
  cargo +1.89.0 clippy --all-targets -- -D warnings
  cargo +1.89.0 test
  anchor build --ignore-keys
  # The IDL in packages/contract must be the one the program builds.
  diff -q target/idl/tilt.json ../packages/contract/src/idl/tilt.json
  diff -q target/types/tilt.ts ../packages/contract/src/idl/tilt.ts
)

if $E2E; then
  step "end-to-end (local stack)"
  ANCHOR_WALLET=$ANCHOR_WALLET pnpm --filter @tilt/chain e2e
  ANCHOR_WALLET=$ANCHOR_WALLET TEST_DATABASE_URL=$PG/tilt_test pnpm --filter @tilt/wallet e2e
  ANCHOR_WALLET=$ANCHOR_WALLET pnpm --filter @tilt/api e2e
fi

step "all green"
