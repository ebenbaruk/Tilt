import type { ReactNode } from "react";
import { PrivyProviders } from "@/components/privy/PrivyProviders";

/** Pages that need a Privy login. The landing and public pages stay free of the Privy SDK. */
export default function WalletLayout({ children }: { children: ReactNode }) {
  return <PrivyProviders>{children}</PrivyProviders>;
}
