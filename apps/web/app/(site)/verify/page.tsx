import type { Metadata } from "next";
import { Page } from "@/components/site/Page";
import { VerifyForm } from "./VerifyForm";

export const metadata: Metadata = { title: "Verify a round" };

export default function VerifyPage() {
  return (
    <Page
      eyebrow="provably fair"
      title="Verify a round"
      lede="Paste the signature of a settled round. Tilt replays it from the VRF randomness recorded on-chain with the public game rules, and compares the result with what the program paid."
    >
      <VerifyForm />
    </Page>
  );
}
