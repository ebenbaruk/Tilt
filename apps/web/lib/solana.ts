import { rollupRpcUrl, solanaCluster, type SolanaCluster } from "./config";

/** Base58 transaction signature (64 bytes, 86–88 chars in practice). */
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

export function isSignature(value: string): boolean {
  return SIGNATURE.test(value);
}

const EXPLORER = "https://explorer.solana.com";

function clusterQuery(): string {
  const cluster = solanaCluster();
  if (cluster === "mainnet") return "";
  if (cluster === "devnet") return "?cluster=devnet";
  return `?cluster=custom&customUrl=${encodeURIComponent("http://localhost:8899")}`;
}

/** Solana account (player wallet) in the explorer. */
export function accountUrl(address: string): string {
  return `${EXPLORER}/address/${encodeURIComponent(address)}${clusterQuery()}`;
}

/** Solana transaction (deposits, withdrawals) in the explorer. */
export function solanaTxUrl(signature: string): string {
  return `${EXPLORER}/tx/${encodeURIComponent(signature)}${clusterQuery()}`;
}

/** Rounds settle in the ephemeral rollup: linkable only when its RPC is configured. */
export function rollupTxUrl(signature: string): string | null {
  const rpc = rollupRpcUrl();
  if (!rpc) return null;
  return `${EXPLORER}/tx/${encodeURIComponent(signature)}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
}

/** CAIP-2 ids (genesis hash prefix) and Circle's USDC mint per cluster; localnet has no onramp. */
const USDC_BY_CLUSTER: Partial<Record<SolanaCluster, { chain: `solana:${string}`; mint: string }>> = {
  mainnet: { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  devnet: { chain: "solana:EtWTRABZaYq6iMfeYKouRu166VL2xqa1", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
};

/** Where an onramp should deliver USDC for this wallet, or null when the cluster has no onramp. */
export function usdcDestination(cluster: SolanaCluster, address: string) {
  const usdc = USDC_BY_CLUSTER[cluster];
  return usdc ? { address, chain: usdc.chain, asset: usdc.mint } : null;
}
