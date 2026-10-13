"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { Box } from "@/components/ui/Box";
import { privyAppId, privyClientId } from "@/lib/config";
import styles from "./PrivyProviders.module.css";

// Tilt pink (oklch .74 .17 350) as hex: Privy's modal only takes hex colors.
const ACCENT = "#f07ab4";

export function PrivyProviders({ children }: { children: ReactNode }) {
  const appId = privyAppId();
  if (!appId) {
    return (
      <div className={styles.wrap}>
        <Box tone="loss" title="login unavailable">
          <p>NEXT_PUBLIC_PRIVY_APP_ID is not set for this build, so login is off. See apps/web/.env.example.</p>
        </Box>
      </div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      clientId={privyClientId()}
      config={{
        // Phantom ("wallet") needs toSolanaWalletConnectors from @privy-io/react-auth/solana, whose
        // @solana-program/memo peer is not installed yet. Email, Google and X cover login until then.
        loginMethods: ["email", "google", "twitter"],
        appearance: { theme: "dark", accentColor: ACCENT, walletChainType: "solana-only" },
        // Every player gets a Privy embedded wallet, wallet logins included: the relay's signer lives on it.
        embeddedWallets: { solana: { createOnLogin: "all-users" }, ethereum: { createOnLogin: "off" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
