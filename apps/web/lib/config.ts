// Public configuration. Next inlines NEXT_PUBLIC_* at build time, so each one must be read by its full name.

export type SolanaCluster = "mainnet" | "devnet" | "localnet";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}: copy apps/web/.env.example to .env.local and fill it in.`);
  return value;
}

function cluster(value: string | undefined): SolanaCluster {
  if (value === "mainnet" || value === "devnet" || value === "localnet") return value;
  throw new Error(`NEXT_PUBLIC_SOLANA_CLUSTER must be mainnet, devnet or localnet, got "${value ?? ""}".`);
}

export function apiUrl(): string {
  return required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL).replace(/\/+$/, "");
}

/** Null when unset: the login pages then explain the missing config instead of crashing the build. */
export function privyAppId(): string | null {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID || null;
}

export function privyClientId(): string | undefined {
  return process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;
}

export function solanaCluster(): SolanaCluster {
  return cluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
}

export function rollupRpcUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_ROLLUP_RPC_URL || undefined;
}
