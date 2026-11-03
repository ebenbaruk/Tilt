#!/usr/bin/env bash
# Publishes the client (the Claude Code mod, the play core and the harnesses) to the
# separate repo players clone and audit, ebenbaruk/tilt-client. Players never get the
# monorepo: chain/, the relay, the api, the runbook and the history stay here.
#
# Run it from an up-to-date main whose scripts/ci.sh passed. The client repo gets one commit
# per publish, named after the monorepo commit it comes from.
set -euo pipefail

cd "$(dirname "$0")/.."

CLIENT_REPO=${CLIENT_REPO:-https://github.com/ebenbaruk/tilt-client.git}
# What players run, and nothing else. Same paths as here, so the harness READMEs work in both.
PATHS=(apps/mod packages/play harnesses)
# Kept out: tests and fixtures players don't need to audit or run.
EXCLUDES=(apps/mod/tests packages/play/test harnesses/companion/test)

[ -z "$(git status --porcelain)" ] || { echo "publish-client: commit or stash your changes first" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "publish-client: publish from an up-to-date main" >&2; exit 1; }

source_sha=$(git rev-parse --short HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone -q "$CLIENT_REPO" "$work/client"
# Replace everything but .git, so files removed here disappear there too.
find "$work/client" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

git archive HEAD "${PATHS[@]}" | tar -x -C "$work/client"
for path in "${EXCLUDES[@]}"; do rm -rf "${work:?}/client/$path"; done
cp -R scripts/client/. "$work/client/"

cd "$work/client"
git add -A
if git diff --cached --quiet; then
  echo "publish-client: nothing new since the last publish"
  exit 0
fi
git commit -q -m "Publish Tilt $source_sha"
git push -q origin HEAD:main
echo "publish-client: published Tilt $source_sha as $(git rev-parse --short HEAD)"
