import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/site/Page";
import { Box } from "@/components/ui/Box";
import { isSignature } from "@/lib/solana";
import { VerifyResult } from "./VerifyResult";

export const metadata: Metadata = { title: "Round verification" };

export default async function VerifySignaturePage({ params }: { params: Promise<{ signature: string }> }) {
  const { signature } = await params;
  const valid = isSignature(signature);
  return (
    <Page eyebrow="provably fair" title="Round verification">
      {valid ? (
        <VerifyResult signature={signature} />
      ) : (
        <Box tone="loss" title="not a signature">
          <p>
            That isn&apos;t a Solana transaction signature. <Link href="/verify">Try another one</Link>.
          </p>
        </Box>
      )}
    </Page>
  );
}
