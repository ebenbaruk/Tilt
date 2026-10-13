#!/usr/bin/env bash
# Local Solana + MagicBlock rollup + VRF oracle on macOS, with the tilt program preloaded.
# chain/scripts/local-stack.sh is Linux-only (Docker host network, linux binaries, io_uring).
#
# Once per boot:   sudo launchctl limit maxfiles 1000000 1000000
# Then:            anchor build --ignore-keys (in chain/), pnpm install, and run this script.
# Env:             ANCHOR_WALLET (upgrade authority / admin keypair; use a throwaway one locally)
#                  CHAIN_DIR (defaults to ./chain), STACK_DIR (defaults to /tmp/tilt-stack)
# Stop with Ctrl-C.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHAIN_DIR="${CHAIN_DIR:-$ROOT/chain}"
STACK_DIR="${STACK_DIR:-/tmp/tilt-stack}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
MB="$(dirname "$(node -e "console.log(require.resolve('@magicblock-labs/ephemeral-validator/package.json', { paths: ['$CHAIN_DIR'] }))")")"
export PATH="$CHAIN_DIR/node_modules/.bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID="$(sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p' "$CHAIN_DIR/programs/tilt/src/lib.rs")"

ulimit -n 1000000
rm -rf "$STACK_DIR" && mkdir -p "$STACK_DIR" && cd "$STACK_DIR"
trap 'kill 0' EXIT

rpc() { curl -s -X POST -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":${3:-[]}}" "http://127.0.0.1:$1"; }

# mAGic…: MagicBlock's local rollup validator identity (public account fixture).
node "$MB/mbTestValidator.js" --rpc-port 8899 --reset \
  --account mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev "$CHAIN_DIR/scripts/validator-identity.json" \
  --upgradeable-program "$PROGRAM_ID" "$CHAIN_DIR/target/deploy/tilt.so" "$(solana-keygen pubkey "$WALLET")" > base.log 2>&1 &
until rpc 8899 getHealth | grep -q ok; do sleep 1; done
# Programs loaded at genesis are only callable a few slots in; the rollup's setup fails before.
until [ "$(rpc 8899 getSlot | grep -o '"result":[0-9]*' | cut -d: -f2)" -ge 20 ] 2>/dev/null; do sleep 1; done
echo "Solana ready: http://127.0.0.1:8899"

RUST_LOG=info node "$MB/ephemeralValidator.js" --no-tui --listen 127.0.0.1:7799 \
  --remotes http://127.0.0.1:8899 --remotes ws://127.0.0.1:8900 > rollup.log 2>&1 &
until rpc 7799 getHealth | grep -q ok; do sleep 1; done
echo "Rollup ready: http://127.0.0.1:7799"

VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:7799 WEBSOCKET_URL=ws://localhost:7800 vrf-oracle > vrf.log 2>&1 &
solana -ul airdrop 100 "$(solana-keygen pubkey "$WALLET")" >/dev/null
echo "Ready (logs in $STACK_DIR). Next: (cd chain && pnpm e2e) to set up the house."
wait
