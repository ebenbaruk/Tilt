import type { NextConfig } from "next";

// The Content-Security-Policy is set per request, with a nonce, in proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), usb=(), payment=(), interest-cohort=()",
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Agent instructions live in the repo's CLAUDE.md; don't generate an AGENTS.md on every dev start.
  agentRules: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
