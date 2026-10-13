#!/usr/bin/env bash
# Starts a local Solana validator + MagicBlock Ephemeral Rollup + VRF oracle with the
# tilt program preloaded, for scripts/e2e.ts. Stop with: docker rm -f tilt-mb-stack tilt-vrf
#
# Runs in Docker (Debian trixie) because the rollup validator needs glibc >= 2.39 and a
# high open-files limit. Requires `anchor build` and `pnpm install` first.
set -euo pipefail

CHAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
IMAGE="node:22-trixie"
RUN_DIR="$CHAIN_DIR/.anchor/local-stack"

mkdir -p "$RUN_DIR"
# Containers first: a running validator keeps writing to the ledgers being removed.
docker rm -f tilt-mb-stack tilt-vrf >/dev/null 2>&1 || true
rm -rf "$RUN_DIR/magicblock-test-storage" "$RUN_DIR/test-ledger"
WALLET_PUBKEY="$("$SOLANA_BIN/solana-keygen" pubkey "$WALLET")"
# By address, so CI (which has no program keypair) can run the stack too.
PROGRAM_ID="$(grep -oP 'declare_id!\("\K[^"]+' "$CHAIN_DIR/programs/tilt/src/lib.rs")"

# No --rm: when a container dies, its logs stay readable for the error message below.
common=(--network host --user "$(id -u):$(id -g)" -e HOME="$HOME" -e RUST_LOG=info
  -e PATH="$CHAIN_DIR/node_modules/.bin:$SOLANA_BIN:/usr/local/bin:/usr/bin:/bin"
  -v "$HOME:$HOME" -w "$RUN_DIR")

# mAGic…: MagicBlock's local rollup validator identity (public account fixture), so delegations can target it.
# seccomp=unconfined: Docker's default profile blocks io_uring, which the Agave validator
# asserts at startup ("assertion failed: io_uring_supported()", exit code 101).
docker run -d --name tilt-mb-stack --ulimit nofile=1048576:1048576 --security-opt seccomp=unconfined "${common[@]}" "$IMAGE" \
  mb-stack --reset --gossip-port 18000 --dynamic-port-range 18001-18040 \
  --account mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev "$CHAIN_DIR/scripts/validator-identity.json" \
  --upgradeable-program "$PROGRAM_ID" "$CHAIN_DIR/target/deploy/tilt.so" "$WALLET_PUBKEY" >/dev/null

echo "Waiting for the MagicBlock stack..."
# Process substitution, not a pipe: under pipefail, `grep -q` closing the pipe early would
# make a ready stack look not ready.
until grep -q "MagicBlock stack is ready" <(docker logs tilt-mb-stack 2>&1); do
  if [ "$(docker inspect -f '{{.State.Running}}' tilt-mb-stack)" != "true" ]; then
    echo "mb-stack exited:"; docker logs --tail 50 tilt-mb-stack; exit 1
  fi
  sleep 1
done

docker run -d --name tilt-vrf "${common[@]}" -e VRF_ORACLE_SKIP_PREFLIGHT=true \
  -e RPC_URL=http://localhost:7799 -e WEBSOCKET_URL=ws://localhost:7800 "$IMAGE" vrf-oracle >/dev/null

"$SOLANA_BIN/solana" -ul airdrop 100 "$WALLET_PUBKEY" >/dev/null
echo "Ready: Solana http://localhost:8899, rollup http://localhost:7799. Run: pnpm e2e"
